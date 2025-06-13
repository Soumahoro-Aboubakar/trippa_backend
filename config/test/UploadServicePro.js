import { promises as fs } from 'fs';
import { join } from 'path';
import { createHash, createDecipherGCM } from 'crypto';
import { inflate } from 'zlib';
import { promisify } from 'util';
import EventEmitter from 'events';

// Configuration
const CONFIG = {
  UPLOAD_DIR: join(process.cwd(), 'uploads'),
  TEMP_DIR: join(process.cwd(), 'temp_uploads'),
  CHUNK_SIZE: 512 * 1024, // 512KB
  MAX_FILE_SIZE: 10 * 1024 * 1024 * 1024, // 10GB
  INACTIVITY_TIMEOUT: 5 * 60 * 1000, // 5 minutes
  CLEANUP_INTERVAL: 60 * 60 * 1000, // 1 heure
  CLEANUP_AFTER: 7 * 24 * 60 * 60 * 1000, // 7 jours
  MAX_CONCURRENT_UPLOADS: 10
};

// États d'upload
const UPLOAD_STATES = {
  INITIALIZING: 'initializing',
  UPLOADING: 'uploading',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  ERROR: 'error'
};

// Classe pour gérer une session d'upload
class UploadSession extends EventEmitter {
  constructor(data) {
    super();
    this.fileId = data.fileId;
    this.userId = data.userId;
    this.fileName = data.fileName;
    this.fileSize = data.fileSize;
    this.mimeType = data.mimeType;
    this.totalChunks = data.totalChunks || Math.ceil(this.fileSize / CONFIG.CHUNK_SIZE);
    this.encryptionKey = data.encryptionKey;
    this.hash = data.hash;
    
    this.state = UPLOAD_STATES.INITIALIZING;
    this.uploadedChunks = new Set(data.uploadedChunks || []);
    this.chunkHashes = new Map(data.chunkHashes || []);
    this.uploadedBytes = 0;
    this.startTime = data.startTime || Date.now();
    this.lastActivity = Date.now();
    this.errorMessage = null;
    
    this.sessionDir = join(CONFIG.TEMP_DIR, this.fileId);
    this.metadataFile = join(this.sessionDir, 'metadata.json');
    this.chunks = new Map();
    
    this._calculateUploadedBytes();
  }

  _calculateUploadedBytes() {
    this.uploadedBytes = 0;
    for (const chunkIndex of this.uploadedChunks) {
      const isLastChunk = chunkIndex === this.totalChunks - 1;
      const chunkSize = isLastChunk ? 
        this.fileSize - (chunkIndex * CONFIG.CHUNK_SIZE) : 
        CONFIG.CHUNK_SIZE;
      this.uploadedBytes += chunkSize;
    }
  }

  async initialize() {
    try {
      await fs.mkdir(this.sessionDir, { recursive: true });
      await this._loadExistingChunks();
      this.state = UPLOAD_STATES.UPLOADING;
      this._updateActivity();
      await this.saveMetadata();
      
      this.emit('initialized');
    } catch (error) {
      this.state = UPLOAD_STATES.ERROR;
      this.errorMessage = error.message;
      this.emit('error', error);
    }
  }

  async _loadExistingChunks() {
    try {
      const files = await fs.readdir(this.sessionDir);
      const chunkFiles = files.filter(f => f.startsWith('chunk_'));
      
      for (const file of chunkFiles) {
        const chunkIndex = parseInt(file.split('_')[1]);
        if (!isNaN(chunkIndex)) {
          this.uploadedChunks.add(chunkIndex);
        }
      }
    } catch (error) {
      // Dossier n'existe pas encore
    }
  }

  async receiveChunk(chunkIndex, data, hash) {
    if (this.state !== UPLOAD_STATES.UPLOADING) {
      throw new Error(`Cannot receive chunk in state: ${this.state}`);
    }

    try {
      // Vérifier si le chunk n'est pas déjà reçu
      if (this.uploadedChunks.has(chunkIndex)) {
        return { success: true, message: 'Chunk already received' };
      }

      // Décompresser et déchiffrer les données
      const decryptedData = this._decryptData(data);
      const decompressedData = await this._decompress(decryptedData);

      // Vérifier l'intégrité
      const computedHash = createHash('sha256').update(decompressedData).digest('hex');
      if (computedHash !== hash) {
        throw new Error('Chunk integrity check failed');
      }

      // Sauvegarder le chunk
      const chunkPath = join(this.sessionDir, `chunk_${chunkIndex}`);
      await fs.writeFile(chunkPath, decompressedData);

      // Mettre à jour l'état
      this.uploadedChunks.add(chunkIndex);
      this.chunkHashes.set(chunkIndex, hash);
      this._updateActivity();
      this._calculateUploadedBytes();

      await this.saveMetadata();

      const progress = {
        uploadedChunks: this.uploadedChunks.size,
        totalChunks: this.totalChunks,
        uploadedBytes: this.uploadedBytes,
        percentage: (this.uploadedBytes / this.fileSize) * 100
      };

      this.emit('progress', progress);

      // Vérifier si l'upload est terminé
      if (this.uploadedChunks.size === this.totalChunks) {
        await this._completeUpload();
      }

      return { success: true, progress };

    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  async _completeUpload() {
    try {
      this.state = UPLOAD_STATES.COMPLETED;
      
      // Assembler tous les chunks
      const fileBuffer = await this._assembleFile();
      
      // Vérifier l'intégrité du fichier complet
      const fileHash = createHash('sha256').update(fileBuffer).digest('hex');
      if (this.hash && fileHash !== this.hash) {
        throw new Error('File integrity check failed');
      }

      await this.saveMetadata();
      this.emit('completed', { fileBuffer, metadata: this.getMetadata() });

    } catch (error) {
      this.state = UPLOAD_STATES.ERROR;
      this.errorMessage = error.message;
      this.emit('error', error);
    }
  }

  async _assembleFile() {
    const chunks = [];
    
    for (let i = 0; i < this.totalChunks; i++) {
      const chunkPath = join(this.sessionDir, `chunk_${i}`);
      const chunkData = await fs.readFile(chunkPath);
      chunks.push(chunkData);
    }
    
    return Buffer.concat(chunks);
  }

  _decryptData(encryptedData) {
    try {
      const key = Buffer.from(this.encryptionKey.padEnd(32, '\0'), 'utf8');
      const iv = Buffer.alloc(16, 0); // IV fixe pour simplifier
      const decipher = createDecipherGCM('aes-256-gcm', key, iv);
      
      let decrypted = decipher.update(encryptedData);
      decipher.final();
      
      return decrypted;
    } catch (error) {
      // Fallback: données non chiffrées
      return encryptedData;
    }
  }

  async _decompress(data) {
    try {
      return await promisify(inflate)(data);
    } catch (error) {
      // Fallback: données non compressées
      return data;
    }
  }

  async pause() {
    if (this.state === UPLOAD_STATES.UPLOADING) {
      this.state = UPLOAD_STATES.PAUSED;
      this._updateActivity();
      await this.saveMetadata();
      this.emit('paused');
    }
  }

  async resume() {
    if (this.state === UPLOAD_STATES.PAUSED) {
      this.state = UPLOAD_STATES.UPLOADING;
      this._updateActivity();
      await this.saveMetadata();
      this.emit('resumed');
    }
  }

  async cancel() {
    this.state = UPLOAD_STATES.CANCELLED;
    await this.cleanup();
    this.emit('cancelled');
  }

  async cleanup() {
    try {
      await fs.rmdir(this.sessionDir, { recursive: true });
    } catch (error) {
      console.error(`Failed to cleanup session ${this.fileId}:`, error);
    }
  }

  _updateActivity() {
    this.lastActivity = Date.now();
  }

  async saveMetadata() {
    try {
      const metadata = {
        fileId: this.fileId,
        userId: this.userId,
        fileName: this.fileName,
        fileSize: this.fileSize,
        mimeType: this.mimeType,
        totalChunks: this.totalChunks,
        encryptionKey: this.encryptionKey,
        hash: this.hash,
        state: this.state,
        uploadedChunks: Array.from(this.uploadedChunks),
        chunkHashes: Array.from(this.chunkHashes.entries()),
        uploadedBytes: this.uploadedBytes,
        startTime: this.startTime,
        lastActivity: this.lastActivity,
        errorMessage: this.errorMessage
      };

      await fs.writeFile(this.metadataFile, JSON.stringify(metadata, null, 2));
    } catch (error) {
      console.error(`Failed to save metadata for ${this.fileId}:`, error);
    }
  }

  getMetadata() {
    return {
      fileId: this.fileId,
      userId: this.userId,
      fileName: this.fileName,
      fileSize: this.fileSize,
      mimeType: this.mimeType,
      state: this.state,
      uploadedChunks: this.uploadedChunks.size,
      totalChunks: this.totalChunks,
      uploadedBytes: this.uploadedBytes,
      percentage: (this.uploadedBytes / this.fileSize) * 100,
      startTime: this.startTime,
      lastActivity: this.lastActivity,
      errorMessage: this.errorMessage
    };
  }

  getMissingChunks() {
    const missing = [];
    for (let i = 0; i < this.totalChunks; i++) {
      if (!this.uploadedChunks.has(i)) {
        missing.push(i);
      }
    }
    return missing;
  }

  isInactive() {
    return Date.now() - this.lastActivity > CONFIG.INACTIVITY_TIMEOUT;
  }

  isAbandoned() {
    return Date.now() - this.lastActivity > CONFIG.CLEANUP_AFTER;
  }
}

// Service principal d'upload
class UploadService extends EventEmitter {
  constructor(io, handleMediaUpload) {
    super();
    this.io = io;
    this.handleMediaUpload = handleMediaUpload;
    this.sessions = new Map();
    this.userSockets = new Map();
    
    this._setupDirectories();
    this._loadExistingSessions();
    this._startCleanupJob();
    this._setupSocketHandlers();
  }

  async _setupDirectories() {
    await fs.mkdir(CONFIG.UPLOAD_DIR, { recursive: true });
    await fs.mkdir(CONFIG.TEMP_DIR, { recursive: true });
  }

  async _loadExistingSessions() {
    try {
      const dirs = await fs.readdir(CONFIG.TEMP_DIR);
      
      for (const dir of dirs) {
        const metadataPath = join(CONFIG.TEMP_DIR, dir, 'metadata.json');
        
        try {
          const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
          const session = new UploadSession(metadata);
          
          // Vérifier si la session n'est pas abandonnée
          if (session.isAbandoned()) {
            await session.cleanup();
            continue;
          }
          
          this.sessions.set(session.fileId, session);
          this._setupSessionHandlers(session);
          
          console.log(`Loaded existing session: ${session.fileId}`);
        } catch (error) {
          console.error(`Failed to load session from ${dir}:`, error);
        }
      }
    } catch (error) {
      console.error('Failed to load existing sessions:', error);
    }
  }

  _setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`Client connected: ${socket.id}`);

      socket.on('authenticate', (data) => {
        if (data.userId) {
          socket?._id = data.userId;
          
          if (!this.userSockets.has(data.userId)) {
            this.userSockets.set(data.userId, new Set());
          }
          this.userSockets.get(data.userId).add(socket);
          
          socket.emit('authenticated', { success: true });
        } else {
          socket.emit('authenticated', { success: false, error: 'User ID required' });
        }
      });

      socket.on('start_upload', async (data) => {
        try {
          await this._handleStartUpload(socket, data);
        } catch (error) {
          socket.emit('upload_error', { error: error.message, fileId: data.fileId });
        }
      });

      socket.on('file_chunk', async (data) => {
        try {
          await this._handleFileChunk(socket, data);
        } catch (error) {
          socket.emit('upload_error', { 
            error: error.message, 
            fileId: data.fileId, 
            chunkIndex: data.index 
          });
        }
      });

      socket.on('pause_upload', async (data) => {
        try {
          await this._handlePauseUpload(socket, data);
        } catch (error) {
          socket.emit('upload_error', { error: error.message, fileId: data.fileId });
        }
      });

      socket.on('resume_upload', async (data) => {
        try {
          await this._handleResumeUpload(socket, data);
        } catch (error) {
          socket.emit('upload_error', { error: error.message, fileId: data.fileId });
        }
      });

      socket.on('cancel_upload', async (data) => {
        try {
          await this._handleCancelUpload(socket, data);
        } catch (error) {
          socket.emit('upload_error', { error: error.message, fileId: data.fileId });
        }
      });

      socket.on('get_uploads', async () => {
        try {
          const uploads = this._getUserUploads(socket?._id);
          socket.emit('uploads_list', uploads);
        } catch (error) {
          socket.emit('upload_error', { error: error.message });
        }
      });

      socket.on('disconnect', () => {
        this._handleDisconnect(socket);
      });
    });
  }

  async _handleStartUpload(socket, data) {
    if (!socket?._id) {
      throw new Error('User not authenticated');
    }

    const { fileId, fileName, fileSize, mimeType, encryptionKey, hash } = data;

    // Vérifications
    if (!fileId || !fileName || !fileSize) {
      throw new Error('Missing required upload parameters');
    }

    if (fileSize > CONFIG.MAX_FILE_SIZE) {
      throw new Error('File size exceeds maximum allowed');
    }

    // Vérifier si une session existe déjà
    let session = this.sessions.get(fileId);

    if (session) {
      // Session existante - reprendre
      if (session.userId !== socket?._id) {
        throw new Error('Unauthorized access to upload session');
      }

      await session.resume();
      
      socket.emit('upload_resumed', {
        fileId,
        uploadedChunks: Array.from(session.uploadedChunks),
        missingChunks: session.getMissingChunks(),
        progress: session.getMetadata()
      });
    } else {
      // Nouvelle session
      const sessionData = {
        fileId,
        userId: socket?._id,
        fileName,
        fileSize,
        mimeType,
        encryptionKey,
        hash
      };

      session = new UploadSession(sessionData);
      this.sessions.set(fileId, session);
      this._setupSessionHandlers(session);

      await session.initialize();

      socket.emit('upload_started', {
        fileId,
        totalChunks: session.totalChunks,
        chunkSize: CONFIG.CHUNK_SIZE
      });
    }
  }

  async _handleFileChunk(socket, data) {
    const { fileId, index, data: chunkData, hash, size } = data;
    
    const session = this.sessions.get(fileId);
    if (!session) {
      throw new Error('Upload session not found');
    }

    if (session.userId !== socket?._id) {
      throw new Error('Unauthorized access to upload session');
    }

    // Décoder les données base64
    const buffer = Buffer.from(chunkData, 'base64');
    
    const result = await session.receiveChunk(index, buffer, hash);
    
    socket.emit('chunk_received', {
      fileId,
      index,
      success: result.success,
      progress: result.progress
    });
  }

  async _handlePauseUpload(socket, data) {
    const session = this.sessions.get(data.fileId);
    if (!session) {
      throw new Error('Upload session not found');
    }

    if (session.userId !== socket?._id) {
      throw new Error('Unauthorized access to upload session');
    }

    await session.pause();
    socket.emit('upload_paused', { fileId: data.fileId });
  }

  async _handleResumeUpload(socket, data) {
    const session = this.sessions.get(data.fileId);
    if (!session) {
      throw new Error('Upload session not found');
    }

    if (session.userId !== socket?._id) {
      throw new Error('Unauthorized access to upload session');
    }

    await session.resume();
    
    socket.emit('upload_resumed', {
      fileId: data.fileId,
      uploadedChunks: Array.from(session.uploadedChunks),
      missingChunks: session.getMissingChunks(),
      progress: session.getMetadata()
    });
  }

  async _handleCancelUpload(socket, data) {
    const session = this.sessions.get(data.fileId);
    if (!session) {
      throw new Error('Upload session not found');
    }

    if (session.userId !== socket?._id) {
      throw new Error('Unauthorized access to upload session');
    }

    await session.cancel();
    this.sessions.delete(data.fileId);
    
    socket.emit('upload_cancelled', { fileId: data.fileId });
  }

  _handleDisconnect(socket) {
    console.log(`Client disconnected: ${socket.id}`);
    
    if (socket?._id) {
      const userSockets = this.userSockets.get(socket?._id);
      if (userSockets) {
        userSockets.delete(socket);
        if (userSockets.size === 0) {
          this.userSockets.delete(socket?._id);
        }
      }
    }
  }

  _setupSessionHandlers(session) {
    session.on('progress', (progress) => {
      this._broadcastToUser(session.userId, 'upload_progress', {
        fileId: session.fileId,
        ...progress
      });
    });

    session.on('completed', async (data) => {
      try {
        // Traiter le fichier avec la fonction externe
        const result = await this.handleMediaUpload(data.fileBuffer, data.metadata);
        
        this._broadcastToUser(session.userId, 'upload_complete', {
          fileId: session.fileId,
          result
        });

        // Nettoyer la session
        await session.cleanup();
        this.sessions.delete(session.fileId);

      } catch (error) {
        console.error(`Failed to process completed upload ${session.fileId}:`, error);
        session.state = UPLOAD_STATES.ERROR;
        session.errorMessage = error.message;
        
        this._broadcastToUser(session.userId, 'upload_error', {
          fileId: session.fileId,
          error: error.message
        });
      }
    });

    session.on('error', (error) => {
      this._broadcastToUser(session.userId, 'upload_error', {
        fileId: session.fileId,
        error: error.message
      });
    });

    session.on('paused', () => {
      this._broadcastToUser(session.userId, 'upload_paused', {
        fileId: session.fileId
      });
    });

    session.on('resumed', () => {
      this._broadcastToUser(session.userId, 'upload_resumed', {
        fileId: session.fileId
      });
    });
  }

  _broadcastToUser(userId, event, data) {
    const userSockets = this.userSockets.get(userId);
    if (userSockets) {
      userSockets.forEach(socket => {
        socket.emit(event, data);
      });
    }
  }

  _getUserUploads(userId) {
    const uploads = [];
    
    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        uploads.push(session.getMetadata());
      }
    }
    
    return uploads;
  }

  _startCleanupJob() {
    setInterval(async () => {
      await this._cleanupInactiveSessions();
    }, CONFIG.CLEANUP_INTERVAL);
  }

  async _cleanupInactiveSessions() {
    const now = Date.now();
    const sessionsToCleanup = [];

    for (const [fileId, session] of this.sessions) {
      if (session.isAbandoned()) {
        sessionsToCleanup.push(fileId);
      } else if (session.isInactive() && session.state === UPLOAD_STATES.UPLOADING) {
        // Pause les uploads inactifs
        await session.pause();
      }
    }

    // Nettoyer les sessions abandonnées
    for (const fileId of sessionsToCleanup) {
      const session = this.sessions.get(fileId);
      if (session) {
        await session.cleanup();
        this.sessions.delete(fileId);
        console.log(`Cleaned up abandoned session: ${fileId}`);
      }
    }
  }

  async shutdown() {
    console.log('Shutting down upload service...');
    
    // Sauvegarder toutes les sessions actives
    const savePromises = [];
    for (const session of this.sessions.values()) {
      if (session.state === UPLOAD_STATES.UPLOADING) {
        session.state = UPLOAD_STATES.PAUSED;
      }
      savePromises.push(session.saveMetadata());
    }
    
    await Promise.all(savePromises);
    console.log('Upload service shutdown complete');
  }
}

export default { UploadService, UPLOAD_STATES, CONFIG };