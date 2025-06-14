
import crypto from 'crypto';
import zlib from 'zlib';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { handleMediaUpload } from '../services/mediaService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const UPLOAD_DIR = path.join(__dirname, 'uploads');
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'u4Vb7x2MTZ3qYpnDfKLaX1gRhPBwEc5s'; // 32 caractères
const MAX_CHUNK_SIZE = process.env.MAX_CHUNK_SIZE || 2 * 1024 * 1024;     // 2 * 1024 * 1024; // 2MB max par chunk
const MAX_FILE_SIZE =  process.env.MAX_FILE_SIZE || 100 * 1024 * 1024;    ///100 * 1024 * 1024; // 100MB max par fichier

// Assurer que le dossier uploads existe
await fs.ensureDir(UPLOAD_DIR);

// Gestionnaire de sessions d'upload
class UploadManager {
  constructor() {
    this.sessions = new Map();
    // Démarrer le nettoyage automatique
    this.startCleanupTimer();//5 min
    this.startAdvancedCleanup();
        this.completedFiles = new Map(); // Tracker les fichiers terminés
  }

  createSession(fileId, userId, expectedChunks, totalSize, fileName, mimeType) {
    const session = {
      fileId,
      userId,
      expectedChunks,
      totalSize,
      fileName,
      mimeType,
      receivedChunks: new Set(),
      chunkData: new Map(),
      createdAt: new Date(),
      lastActivity: new Date()
    };
    
    this.sessions.set(fileId, session);
    return session;
  }

  getSession(fileId) {
    return this.sessions.get(fileId);
  }

  addChunk(fileId, chunkIndex, chunkData) {
    const session = this.sessions.get(fileId);
    if (!session) return false;

    session.receivedChunks.add(chunkIndex);
    if (chunkData) {
      session.chunkData.set(chunkIndex, chunkData);
    }
    session.lastActivity = new Date();
    
    return true;
  }

  isComplete(fileId) {
    const session = this.sessions.get(fileId);
    if (!session) return false;
    
    return session.receivedChunks.size === session.expectedChunks;
  }

 removeSession(fileId) {
    const session = this.sessions.get(fileId);
    if (session) {
      console.log(`Suppression de la session: ${fileId}`);
      this.sessions.delete(fileId);
    }
  }

  startCleanupTimer() {
    setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000); // Nettoyer toutes les 5 minutes
  }

  cleanup() {
    const now = new Date();
    const TIMEOUT = 30 * 60 * 1000; // 30 minutes

    for (const [fileId, session] of this.sessions.entries()) {
      if (now - session.lastActivity > TIMEOUT) {
        this.removeSession(fileId);
        // Nettoyer les fichiers temporaires
        this.cleanupTempFiles(fileId).catch(console.error);
      }
    }
  }

  async cleanupTempFiles(fileId) {
    const chunkDir = path.join(UPLOAD_DIR, fileId);
    try {
      await fs.remove(chunkDir);
      console.log(`Cleaned up temp files for ${fileId}`);
    } catch (error) {
      console.error(`Failed to cleanup temp files for ${fileId}:`, error);
    }
  }


  // Nouveau: Marquer un fichier comme terminé avec succès
  markFileCompleted(fileId, filePath) {
    this.completedFiles.set(fileId, {
      path: filePath,
      completedAt: new Date(),
      fileId: fileId
    });
    console.log(`File marked as completed: ${fileId} at ${filePath}`);
  }

  
  startAdvancedCleanup() {
    // Timer 1: Nettoyer les fichiers terminés toutes les heures
    setInterval(() => {
      this.cleanupCompletedFiles();
    }, 60 * 60 * 1000); // 1 heure

    // Timer 2: Nettoyer tous les fichiers obsolètes toutes les 4 heures  
    setInterval(() => {
      this.cleanupAllObsoleteFiles();
    }, 4 * 60 * 60 * 1000); // 4 heures

    console.log('Advanced cleanup timers started');
  }

   // Nettoyage des fichiers terminés depuis 1h+
  async cleanupCompletedFiles() {
    const now = new Date();
    const ONE_HOUR = 60 * 60 * 1000;
    let cleanedCount = 0;

    console.log('Starting cleanup of completed files (1h+)...');
    
    for (const [fileId, fileInfo] of this.completedFiles.entries()) {
      const fileAge = now - fileInfo.completedAt;
      
      if (fileAge > ONE_HOUR) {
        try {
          // Supprimer le fichier du système
          if (fileInfo.path && await fs.pathExists(fileInfo.path)) {
            await fs.remove(fileInfo.path);
            console.log(`Deleted completed file: ${fileInfo.path}`);
          }
          
          // Supprimer de la mémoire
          this.completedFiles.delete(fileId);
          
          // Supprimer dossier temp si existe encore
          await this.cleanupTempFiles(fileId);
          
          cleanedCount++;
          
        } catch (error) {
          console.error(`Failed to cleanup completed file ${fileId}:`, error);
        }
      }
    } console.log(`Completed files cleanup: ${cleanedCount} files removed`);
  }
   // Nettoyage de tous les fichiers obsolètes depuis 4h+
  async cleanupAllObsoleteFiles() {
    const now = new Date();
    const FOUR_HOURS = 4 * 60 * 60 * 1000;
    let cleanedSessions = 0;
    let cleanedFiles = 0;
    let cleanedDirs = 0;

    console.log('Starting cleanup of all obsolete files (4h+)...');

    // 1. Nettoyer les sessions actives obsolètes (annulées, en attente, etc.)
    for (const [fileId, session] of this.sessions.entries()) {
      const sessionAge = now - session.createdAt;
      
      if (sessionAge > FOUR_HOURS) {
        try {
          await this.cleanupTempFiles(fileId);
          this.removeSession(fileId);
          cleanedSessions++;
          console.log(`Cleaned obsolete session: ${fileId}`);
        } catch (error) {
          console.error(`Failed to cleanup session ${fileId}:`, error);
        }
      }
    }

    // 2. Nettoyer les fichiers terminés obsolètes
    for (const [fileId, fileInfo] of this.completedFiles.entries()) {
      const fileAge = now - fileInfo.completedAt;
      
      if (fileAge > FOUR_HOURS) {
        try {
          if (fileInfo.path && await fs.pathExists(fileInfo.path)) {
            await fs.remove(fileInfo.path);
          }
          this.completedFiles.delete(fileId);
          await this.cleanupTempFiles(fileId);
          cleanedFiles++;
          console.log(`Cleaned obsolete completed file: ${fileId}`);
        } catch (error) {
          console.error(`Failed to cleanup obsolete file ${fileId}:`, error);
        }
      }
    }

    // 3. Nettoyer les dossiers orphelins
    cleanedDirs = await this.cleanupOrphanDirectories(FOUR_HOURS);

    console.log(`All obsolete files cleanup: ${cleanedSessions} sessions, ${cleanedFiles} files, ${cleanedDirs} directories removed`);
  }
 // Nettoyer les dossiers orphelins dans UPLOAD_DIR
  async cleanupOrphanDirectories(maxAge) {
    let cleanedCount = 0;
    
    try {
      if (!await fs.pathExists(UPLOAD_DIR)) {
        return cleanedCount;
      }

      const items = await fs.readdir(UPLOAD_DIR);
      
      for (const item of items) {
        const itemPath = path.join(UPLOAD_DIR, item);
        
        try {
          const stats = await fs.stat(itemPath);
          
          if (stats.isDirectory()) {
            const isTracked = this.sessions.has(item) || this.completedFiles.has(item);
            const itemAge = Date.now() - stats.mtime.getTime();
            
            // Supprimer si pas suivi ET trop vieux
            if (!isTracked && itemAge > maxAge) {
              await fs.remove(itemPath);
              cleanedCount++;
              console.log(`Removed orphan directory: ${itemPath}`);
            }
          }
        } catch (error) {
          console.error(`Error processing ${itemPath}:`, error);
        }
      }
    } catch (error) {
      console.error('Error during orphan cleanup:', error);
    }
    
    return cleanedCount;
  }
 // Amélioration de la méthode existante cleanupTempFiles
  async cleanupTempFiles(fileId) {
    const chunkDir = path.join(UPLOAD_DIR, fileId);
    try {
      if (await fs.pathExists(chunkDir)) {
        await fs.remove(chunkDir);
        console.log(`Cleaned temp files for: ${fileId}`);
      }
    } catch (error) {
      console.error(`Failed to cleanup temp files for ${fileId}:`, error);
    }
  }
  // Statistiques pour monitoring
  getCleanupStats() {
    const now = new Date();
    const ONE_HOUR = 60 * 60 * 1000;
    const FOUR_HOURS = 4 * 60 * 60 * 1000;

    let completedReadyForCleanup = 0;
    let sessionsReadyForCleanup = 0;

    // Compter les fichiers terminés prêts pour nettoyage (1h+)
    for (const [, fileInfo] of this.completedFiles.entries()) {
      if (now - fileInfo.completedAt > ONE_HOUR) {
        completedReadyForCleanup++;
      }
    }

    // Compter les sessions prêtes pour nettoyage (4h+)
    for (const [, session] of this.sessions.entries()) {
      if (now - session.createdAt > FOUR_HOURS) {
        sessionsReadyForCleanup++;
      }
    }

    return {
      activeSessions: this.sessions.size,
      completedFiles: this.completedFiles.size,
      completedReadyForCleanup,
      sessionsReadyForCleanup,
      totalTracked: this.sessions.size + this.completedFiles.size
    };
  }

  addChunk(fileId, chunkIndex, chunkData) {
    const session = this.sessions.get(fileId);
    if (!session) return false;

    session.receivedChunks.add(chunkIndex);
    if (chunkData) {
      session.chunkData.set(chunkIndex, chunkData);
    }
    session.lastActivity = new Date();
    
    return true;
  }

  isComplete(fileId) {
    const session = this.sessions.get(fileId);
    if (!session) return false;
    
    return session.receivedChunks.size === session.expectedChunks;
  }

  removeSession(fileId) {
    this.sessions.delete(fileId);
  }

  // Timer existant - garder tel quel
  startCleanupTimer() {
    setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000); // 5 minutes
  }
  // Méthode existante - garder tel quel
  cleanup() {
    const now = new Date();
    const TIMEOUT = 30 * 60 * 1000; // 30 minutes

    for (const [fileId, session] of this.sessions.entries()) {
      if (now - session.lastActivity > TIMEOUT) {
        this.removeSession(fileId);
        this.cleanupTempFiles(fileId).catch(console.error);
      }
    }
  }
}

// Instance globale du gestionnaire d'upload
const uploadManager = new UploadManager();

function decryptChunk(encryptedData, encryptionKey) {
  try {
    console.log(`Tentative de déchiffrement: ${encryptedData.length} bytes`);
    
    // Créer la clé de 32 bytes exactement comme dans Flutter
    const keyBuffer = Buffer.alloc(32);
    const keyBytes = Buffer.from(encryptionKey, 'utf8');
    
    // Copier les bytes de la clé et remplir avec des zéros
    for (let i = 0; i < 32; i++) {
      if (i < keyBytes.length) {
        keyBuffer[i] = keyBytes[i];
      } else {
        keyBuffer[i] = 0;
      }
    }
    
    console.log(`Clé générée: ${keyBuffer.toString('hex')}`);
    
    // IV de 16 bytes tous à zéro (comme dans Flutter)
    const iv = Buffer.alloc(16, 0);
    
    console.log(`IV utilisé: ${iv.toString('hex')}`);
    
    // Créer le déchiffreur
    const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuffer, iv);
    decipher.setAutoPadding(true);
    
    // Déchiffrer
    const decrypted = Buffer.concat([
      decipher.update(encryptedData),
      decipher.final()
    ]);
    
    console.log(`Déchiffrement réussi: ${decrypted.length} bytes`);
    return decrypted;
    
  } catch (error) {
    console.error(`Erreur de déchiffrement détaillée:`, {
      message: error.message,
      code: error.code,
      encryptedDataLength: encryptedData.length,
      keyLength: encryptionKey.length
    });
    throw new Error(`Decryption failed: ${error.message}`);
  }
}

// Fonction de décompression avec gestion d'erreur améliorée
function decompressChunk(compressedData) {
  try {
    console.log(`Tentative de décompression: ${compressedData.length} bytes`);
    const decompressed = zlib.inflateSync(compressedData);
    console.log(`Décompression réussie: ${decompressed.length} bytes`);
    return decompressed;
  } catch (error) {
    console.error(`Erreur de décompression:`, {
      message: error.message,
      compressedDataLength: compressedData.length,
      firstBytes: compressedData.slice(0, 16).toString('hex')
    });
    throw new Error(`Decompression failed: ${error.message}`);
  }
}

// Fonction de validation du hash améliorée
function calculateHash(data) {
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  console.log(`Hash calculé: ${hash}`);
  return hash;
}


// Validation des inputs
function validateChunkInput(data) {
  const required = ['index', 'fileId', 'data', 'userId', 'size', 'hash'];
  
  for (const field of required) {
    if (!(field in data)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  // Validation des types
  if (typeof data.index !== 'number' || data.index < 0) {
    throw new Error('Invalid chunk index');
  }

  if (typeof data.size !== 'number' || data.size <= 0 || data.size > MAX_CHUNK_SIZE) {
    throw new Error('Invalid chunk size');
  }

  if (typeof data.fileId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(data.fileId)) {
    throw new Error('Invalid fileId format');
  }

  if (typeof data.userId !== 'string' || data.userId.length === 0) {
    throw new Error('Invalid userId');
  }

  if (typeof data.hash !== 'string' || !/^[a-f0-9]{64}$/.test(data.hash)) {
    throw new Error('Invalid hash format');
  }

  return true;
}

// Fonction pour obtenir le statut d'une session
async function getSessionStatus(fileId) {
  const session = uploadManager.getSession(fileId);

  if (!session) {
    throw new Error('Upload session not found');
  }

  // Vérifier quels chunks existent déjà sur le disque
  const chunkDir = path.join(UPLOAD_DIR, fileId);
  const existingChunks = [];
  
  try {
    if (await fs.pathExists(chunkDir)) {
      const files = await fs.readdir(chunkDir);
      for (const file of files) {
        const match = file.match(/^chunk_(\d+)$/);
        if (match) {
          existingChunks.push(parseInt(match[1]));
        }
      }
    }
  } catch (error) {
    console.error('Error checking existing chunks:', error);
    throw new Error('Error checking existing chunks');
  }

  return {
    fileId,
    expectedChunks: session.expectedChunks,
    receivedChunks: Array.from(session.receivedChunks),
    existingChunks: existingChunks.sort((a, b) => a - b),
    isComplete: uploadManager.isComplete(fileId),
    totalSize: session.totalSize
  };
}

// Fonction pour reconstruire le fichier final
async function reconstructFile(fileId, session) {
  const chunkDir = path.join(UPLOAD_DIR, fileId);
  const chunks = [];
  
  // Lire tous les chunks dans l'ordre
  for (let i = 0; i < session.expectedChunks; i++) {
    const chunkPath = path.join(chunkDir, `chunk_${i}`);
    
    if (!await fs.pathExists(chunkPath)) {
      throw new Error(`Missing chunk ${i}`);
    }
    
    const chunkData = await fs.readFile(chunkPath);
    chunks.push(chunkData);
  }
  
  // Concaténer tous les chunks
  return Buffer.concat(chunks);
}


// Fonction principale pour configurer les événements Socket.IO
export const mediaUploader = async (socket) => {
  // Initialisation d'une session d'upload
 socket.on('upload_init', async (data) => {
  try {
    const { fileId, userId, expectedChunks, totalSize, fileName, mimeType } = data;
    
    // Validation
    if (!fileId || !userId || !expectedChunks || !totalSize) {
      socket.emit('upload_error', { 
        fileId, 
        error: 'Missing required fields for upload initialization' 
      });
      return;
    }

    if (totalSize > MAX_FILE_SIZE) {
      socket.emit('upload_error', { 
        fileId, 
        error: 'File size exceeds maximum allowed size' 
      });
      return;
    }

    // NOUVEAU: Vérifier si le fichier a déjà été complété
    const completedFile = uploadManager.completedFiles.get(fileId);
    if (completedFile) {
      console.log(`Fichier déjà complété lors de l'init: ${fileId}`);
      socket.emit('upload_initialized', { 
        fileId, 
        existingChunks: Array.from({length: expectedChunks}, (_, i) => i),
        alreadyCompleted: true,
        message: 'File already completed' 
      });
      return;
    }

    // Vérifier si une session existe déjà
    let session = uploadManager.getSession(fileId);
    if (session) {
      console.log(`Session existante trouvée pour: ${fileId}`);
    } else {
      // Créer nouvelle session
      session = uploadManager.createSession(fileId, userId, expectedChunks, totalSize, fileName, mimeType);
    }
    
    // Créer le dossier pour les chunks
    const chunkDir = path.join(UPLOAD_DIR, fileId);
    await fs.ensureDir(chunkDir);

    // Vérifier les chunks déjà présents
    const existingChunks = [];
    try {
      const files = await fs.readdir(chunkDir);
      for (const file of files) {
        const match = file.match(/^chunk_(\d+)$/);
        if (match) {
          const chunkIndex = parseInt(match[1]);
          existingChunks.push(chunkIndex);
          uploadManager.addChunk(fileId, chunkIndex, null);
        }
      }
    } catch (error) {
      console.error('Error checking existing chunks:', error);
    }

    socket.emit('upload_initialized', { 
      fileId, 
      existingChunks: existingChunks.sort((a, b) => a - b),
      message: 'Upload session initialized successfully' 
    });

  } catch (error) {
    console.error('Upload init error:', error);
    socket.emit('upload_error', { 
      fileId: data.fileId, 
      error: error.message 
    });
  }
});

  async function handleUploadCompletion(socket, fileId, session) {
  try {
    const finalBuffer = await reconstructFile(fileId, session);
    
    const mediaResult = await handleMediaUpload(socket, {
      buffer: [finalBuffer],
      fileName: session.fileName || `${fileId}.bin`,
      mimeType: session.mimeType || 'application/octet-stream',
      mediaDuration: data.mediaDuration || null
    });

    if (mediaResult && mediaResult.filePath) {
      uploadManager.markFileCompleted(fileId, mediaResult.filePath);
    }
    
    socket.emit('upload_complete', {
      fileId,
      success: true,
      result: mediaResult
    });

    // SOLUTION 4: Délayer la suppression de la session
    setTimeout(async () => {
      await uploadManager.cleanupTempFiles(fileId);
      uploadManager.removeSession(fileId);
      console.log(`Session ${fileId} supprimée après délai`);
    }, 30000); // Attendre 30 secondes avant de supprimer

  } catch (error) {
    console.error('Erreur de reconstruction/upload:', error);
    socket.emit('upload_complete', {
      fileId,
      success: false,
      error: error.message
    });
  }
}


// 1. Améliorer la gestion des chunks déjà reçus
socket.on('file_chunk', async (data) => {
  try {
    console.log(`\n=== Traitement du chunk ${data.index} ===`);
    console.log(`FileId: ${data.fileId}`);
    
    // Validation des inputs
    validateChunkInput(data);
    
    const { index, fileId, data: encodedChunk, userId, size, hash } = data;
    
    // Vérifier la session
    const session = uploadManager.getSession(fileId);
    if (!session) {
      console.log(`Session non trouvée pour fileId: ${fileId}`);
      
      // SOLUTION 1: Vérifier si le fichier a déjà été complété
      const completedFile = uploadManager.completedFiles.get(fileId);
      if (completedFile) {
        console.log(`Fichier déjà complété: ${fileId}`);
        socket.emit('chunk_received', {
          fileId,
          index,
          success: true,
          message: 'File already completed',
          alreadyCompleted: true
        });
        
        // Envoyer aussi upload_complete pour informer le client
        socket.emit('upload_complete', {
          fileId,
          success: true,
          message: 'File was already uploaded',
          alreadyCompleted: true
        });
        return;
      }
      
      // Si vraiment aucune session trouvée
      socket.emit('chunk_received', {
        fileId,
        index,
        success: false,
        error: 'No active upload session found. Please reinitialize upload.'
      });
      return;
    }

    // Vérifier que le chunk n'a pas déjà été reçu
    if (session.receivedChunks.has(index)) {
      console.log(`Chunk ${index} déjà reçu`);
      socket.emit('chunk_received', {
        fileId,
        index,
        success: true,
        message: 'Chunk already received'
      });
      
      // SOLUTION 2: Vérifier si l'upload est déjà terminé
      if (uploadManager.isComplete(fileId)) {
        socket.emit('upload_complete', {
          fileId,
          success: true,
          message: 'Upload already completed'
        });
      }
      return;
    }

    // Vérifier si le chunk existe déjà sur le disque
    const chunkPath = path.join(UPLOAD_DIR, fileId, `chunk_${index}`);
    if (await fs.pathExists(chunkPath)) {
      console.log(`Chunk ${index} existe déjà sur le disque`);
      
      // Marquer comme reçu si pas déjà fait
      uploadManager.addChunk(fileId, index, null);
      
      socket.emit('chunk_received', {
        fileId,
        index,
        success: true,
        message: 'Chunk already exists on disk'
      });
      
      // Vérifier si l'upload est terminé
      if (uploadManager.isComplete(fileId)) {
        console.log(`Upload terminé pour le fichier: ${fileId}`);
        await handleUploadCompletion(socket, fileId, session);
      }
      return;
    }

    // Traitement normal du chunk...
    console.log(`Décodage base64: ${encodedChunk.length} caractères`);
    const encryptedData = Buffer.from(encodedChunk, 'base64');
    console.log(`Données chiffrées: ${encryptedData.length} bytes`);
    
    // Déchiffrer
    const compressedData = decryptChunk(encryptedData, ENCRYPTION_KEY);
    
    // Décompresser
    const originalData = decompressChunk(compressedData);
    
    // Vérifier la taille
    if (originalData.length !== size) {
      console.error(`Erreur de taille: attendu ${size}, reçu ${originalData.length}`);
      socket.emit('chunk_received', {
        fileId,
        index,
        success: false,
        error: `Size mismatch: expected ${size}, got ${originalData.length}`
      });
      return;
    }
    
    // Vérifier le hash
    const calculatedHash = calculateHash(originalData);
    if (calculatedHash !== hash) {
      console.error(`Erreur de hash: attendu ${hash}, calculé ${calculatedHash}`);
      socket.emit('chunk_received', {
        fileId,
        index,
        success: false,
        error: 'Hash verification failed'
      });
      return;
    }
    
    // Sauvegarder le chunk
    await fs.writeFile(chunkPath, originalData);
    console.log(`Chunk ${index} sauvegardé: ${chunkPath}`);
    
    // Marquer le chunk comme reçu
    uploadManager.addChunk(fileId, index, originalData);
    
    // Répondre au client
    socket.emit('chunk_received', {
      fileId,
      index,
      success: true
    });

    console.log(`=== Chunk ${index} traité avec succès ===\n`);

    // Vérifier si l'upload est terminé
    if (uploadManager.isComplete(fileId)) {
      console.log(`Upload terminé pour le fichier: ${fileId}`);
      await handleUploadCompletion(socket, fileId, session);
    }

  } catch (error) {
    console.error(`Erreur de traitement du chunk ${data.index}:`, error);
    socket.emit('chunk_received', {
      fileId: data.fileId,
      index: data.index,
      success: false,
      error: error.message
    });
  }
});



  // Obtenir le statut d'une session
  socket.on('get_upload_status', async (data) => {
    try {
      const { fileId } = data;
      const status = await getSessionStatus(fileId);
      socket.emit('upload_status', status);
    } catch (error) {
      socket.emit('upload_error', {
        fileId: data.fileId,
        error: error.message
      });
    }
  });

  // Annuler un upload
  socket.on('cancel_upload', async (data) => {
    try {
      const { fileId } = data;
      await uploadManager.cleanupTempFiles(fileId);
      uploadManager.removeSession(fileId);
      socket.emit('upload_cancelled', { fileId });
    } catch (error) {
      socket.emit('upload_error', {
        fileId: data.fileId,
        error: error.message
      });
    }
  });
};