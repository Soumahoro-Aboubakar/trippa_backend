import { handleMediaUpload } from "../services/mediaService.js";
import fs from "fs";
import path from "path";
import os from "os";

// Constantes pour la configuration
const CHUNK_TIMEOUT = 300000; // 5 minutes (plus long pour les connexions instables)
const PROGRESS_REPORT_INTERVAL = 5; // Rapport tous les 5 chunks
const CLEANUP_INTERVAL = 3600000; // 1 heure (plus long pour permettre les reprises)
const TEMP_UPLOAD_DIR = path.join(os.tmpdir(), "trippa_uploads");

// Créer le répertoire temporaire s'il n'existe pas
if (!fs.existsSync(TEMP_UPLOAD_DIR)) {
  fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });
}

class UploadService {
  constructor(io) {
    this.io = io;
    this.activeUploads = new Map();
    this.persistentUploads = new Map(); // Pour stocker les infos entre les sessions

    // Charger les uploads persistants au démarrage
    this.loadPersistentUploads();

    // Nettoyage périodique des uploads abandonnés
    setInterval(() => this.cleanupStaleUploads(), CLEANUP_INTERVAL);
  }

  /**
   * Charge les informations des uploads persistants
   */
  loadPersistentUploads() {
    try {
      const files = fs.readdirSync(TEMP_UPLOAD_DIR);
      for (const file of files) {
        if (file.endsWith(".json")) {
          try {
            const fileId = file.replace(".json", "");
            const metadataPath = path.join(TEMP_UPLOAD_DIR, file);
            const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));

            // Restaurer les informations de l'upload
            this.persistentUploads.set(fileId, {
              ...metadata,
              receivedChunks: new Set(metadata.receivedChunks),
              lastActivity: Date.now(),
              isPaused: true,
            });
          } catch (err) {
            console.error(
              `Erreur lors du chargement de l'upload persistant: ${file}`,
              err
            );
          }
        }
      }
    } catch (err) {
      console.error("Erreur lors du chargement des uploads persistants:", err);
    }
  }

  /**
   * Sauvegarde les métadonnées d'un upload pour permettre la reprise
   * @param {string} fileId - L'ID du fichier
   * @param {Object} upload - Les données d'upload
   */
  savePersistentUpload(fileId, upload) {
    try {
      const metadataPath = path.join(TEMP_UPLOAD_DIR, `${fileId}.json`);
      const chunkDirPath = path.join(TEMP_UPLOAD_DIR, fileId);

      // Créer le répertoire pour les chunks si nécessaire
      if (!fs.existsSync(chunkDirPath)) {
        fs.mkdirSync(chunkDirPath, { recursive: true });
      }

      // Convertir Set en Array pour la sérialisation
      const serializedUpload = {
        ...upload,
        receivedChunks: Array.from(upload.receivedChunks),
        socket: undefined, // Ne pas sérialiser le socket
        buffer: undefined, // Ne pas sérialiser le buffer complet
        lastActivity: Date.now(),
      };

      // Sauvegarder les métadonnées
      fs.writeFileSync(metadataPath, JSON.stringify(serializedUpload), "utf8");

      // Sauvegarder les chunks individuellement
      for (const index of upload.receivedChunks) {
        const chunkPath = path.join(chunkDirPath, `${index}.chunk`);
        if (upload.buffer[index] && !fs.existsSync(chunkPath)) {
          fs.writeFileSync(chunkPath, upload.buffer[index]);
        }
      }

      // Mettre à jour la map des uploads persistants
      this.persistentUploads.set(fileId, {
        ...serializedUpload,
        receivedChunks: upload.receivedChunks, // Garder le Set original
      });

      return true;
    } catch (err) {
      console.error(
        `Erreur lors de la sauvegarde de l'upload persistant: ${fileId}`,
        err
      );
      return false;
    }
  }

  /**
   * Charge les chunks d'un upload persistant
   * @param {string} fileId - L'ID du fichier
   * @param {number} totalChunks - Nombre total de chunks
   * @returns {Array} - Tableau des chunks chargés
   */
  loadPersistentChunks(fileId, totalChunks) {
    try {
      const chunkDirPath = path.join(TEMP_UPLOAD_DIR, fileId);
      const buffer = new Array(totalChunks);

      if (fs.existsSync(chunkDirPath)) {
        const files = fs.readdirSync(chunkDirPath);
        for (const file of files) {
          if (file.endsWith(".chunk")) {
            const index = parseInt(file.replace(".chunk", ""));
            const chunkPath = path.join(chunkDirPath, file);
            buffer[index] = fs.readFileSync(chunkPath);
          }
        }
      }

      return buffer;
    } catch (err) {
      console.error(
        `Erreur lors du chargement des chunks persistants: ${fileId}`,
        err
      );
      return new Array(totalChunks);
    }
  }

  /**
   * Supprime les données persistantes d'un upload
   * @param {string} fileId - L'ID du fichier
   */
  removePersistentUpload(fileId) {
    try {
      const metadataPath = path.join(TEMP_UPLOAD_DIR, `${fileId}.json`);
      const chunkDirPath = path.join(TEMP_UPLOAD_DIR, fileId);

      // Supprimer les métadonnées
      if (fs.existsSync(metadataPath)) {
        fs.unlinkSync(metadataPath);
      }

      // Supprimer les chunks
      if (fs.existsSync(chunkDirPath)) {
        const files = fs.readdirSync(chunkDirPath);
        for (const file of files) {
          fs.unlinkSync(path.join(chunkDirPath, file));
        }
        fs.rmdirSync(chunkDirPath);
      }

      // Supprimer de la map
      this.persistentUploads.delete(fileId);

      return true;
    } catch (err) {
      console.error(
        `Erreur lors de la suppression de l'upload persistant: ${fileId}`,
        err
      );
      return false;
    }
  }

  /**
   * Initialise les gestionnaires d'événements pour les sockets
   * @param {Socket} socket - L'instance de socket à configurer
   */
  registerSocketHandlers(socket) {
    // Gestionnaire pour démarrer un téléchargement
    socket.on("start_upload", (metadata) =>
      this.handleStartUpload(socket, metadata)
    );

    // Gestionnaire pour recevoir les chunks de fichier
    socket.on("file_chunk", async (data) => this.handleFileChunk(socket, data));

    // Gestionnaire pour annuler un téléchargement
    socket.on("cancel_upload", (data) =>
      this.cancelUpload(data.fileId, socket)
    );

    // Gestionnaire pour mettre en pause un téléchargement
    socket.on("pause_upload", (data) => this.pauseUpload(data.fileId, socket));

    // Gestionnaire pour reprendre un téléchargement
    socket.on("resume_upload", (data) =>
      this.resumeUpload(data.fileId, socket)
    );

    // Gestionnaire pour récupérer les uploads en cours/en pause
    socket.on("get_uploads", (data, callback) => {
      const uploads = this.getUserUploads(socket.userId || data.userId);
      callback(uploads);
    });

    // Nettoyage lors de la déconnexion (mais sans supprimer les données)
    socket.on("disconnect", () => this.handleDisconnect(socket));
  }

  /**
   * Récupère les uploads d'un utilisateur
   * @param {string} userId - ID de l'utilisateur
   * @returns {Array} - Liste des uploads de l'utilisateur
   */
  getUserUploads(userId) {
    if (!userId) return [];

    const uploads = [];

    // Ajouter les uploads actifs
    for (const [fileId, upload] of this.activeUploads.entries()) {
      if (upload.userId === userId) {
        uploads.push(this.getUploadInfo(fileId));
      }
    }

    // Ajouter les uploads persistants
    for (const [fileId, upload] of this.persistentUploads.entries()) {
      if (upload.userId === userId && !this.activeUploads.has(fileId)) {
        uploads.push({
          fileId,
          fileName: upload.fileName,
          mimeType: upload.mimeType,
          progress: Math.floor(
            (upload.receivedChunks.size / upload.totalChunks) * 100
          ),
          isPaused: true,
          totalChunks: upload.totalChunks,
          receivedChunks: upload.receivedChunks.size,
          lastActivity: upload.lastActivity,
        });
      }
    }

    return uploads;
  }

  /**
   * Gère le début d'un upload
   * @param {Socket} socket - L'instance de socket
   * @param {Object} metadata - Les métadonnées du fichier
   */
  handleStartUpload(socket, metadata) {
    try {
      // Validation des métadonnées
      if (
        !metadata ||
        !metadata.fileId ||
        !metadata.totalChunks ||
        metadata.totalChunks <= 0
      ) {
        return socket.emit("upload_error", {
          fileId: metadata?.fileId,
          error: "Métadonnées invalides",
          code: "INVALID_METADATA",
        });
      }

      // Vérifier si c'est une reprise d'upload
      const persistentUpload = this.persistentUploads.get(metadata.fileId);
      if (persistentUpload) {
        // Charger les chunks déjà reçus
        const buffer = this.loadPersistentChunks(
          metadata.fileId, //le fileId est composer du lien de local (path file), combinner au id de l'utilisateur
          metadata.totalChunks
        ); //totalChunks represent la taille en entier

        // Initialiser l'upload avec les données persistantes
        this.activeUploads.set(metadata.fileId, {
          ...metadata,
          buffer,
          receivedChunks: new Set(persistentUpload.receivedChunks),
          socket,
          startTime: Date.now(),
          lastActivity: Date.now(),
          resumedAt: Date.now(),
          previouslyReceived: persistentUpload.receivedChunks.size,
        });

        // Confirmer la reprise de l'upload au client
        socket.emit("upload_resumed", {
          fileId: metadata.fileId,
          receivedChunks: Array.from(persistentUpload.receivedChunks),
          progress: Math.floor(
            (persistentUpload.receivedChunks.size / metadata.totalChunks) * 100
          ),
        });
      } else {
        // Initialiser un nouvel upload
        this.activeUploads.set(metadata.fileId, {
          ...metadata,
          buffer: new Array(metadata.totalChunks),
          receivedChunks: new Set(),
          socket,
          startTime: Date.now(),
          lastActivity: Date.now(),
          userId: socket.userId || metadata.userId,
        });

        // Confirmer le début de l'upload au client
        socket.emit("upload_started", { fileId: metadata.fileId });
      }
    } catch (error) {
      console.error("Erreur lors du démarrage de l'upload:", error);
      socket.emit("upload_error", {
        fileId: metadata?.fileId,
        error: "Erreur interne",
        code: "INTERNAL_ERROR",
      });
    }
  }

  /**
   * Met en pause un téléchargement
   * @param {string} fileId - L'ID du fichier
   * @param {Socket} socket - L'instance de socket
   */
  pauseUpload(fileId, socket) {
    const upload = this.activeUploads.get(fileId);
    if (!upload) {
      return socket.emit("upload_error", {
        fileId,
        error: "Upload non trouvé",
        code: "UPLOAD_NOT_FOUND",
      });
    }

    // Sauvegarder l'état actuel pour permettre la reprise
    if (this.savePersistentUpload(fileId, upload)) {
      // Marquer comme en pause mais ne pas supprimer les données
      upload.isPaused = true;
      upload.pausedAt = Date.now();

      socket.emit("upload_paused", {
        fileId,
        receivedChunks: upload.receivedChunks.size,
        totalChunks: upload.totalChunks,
        progress: Math.floor(
          (upload.receivedChunks.size / upload.totalChunks) * 100
        ),
      });

      // Libérer la mémoire active mais garder les données persistantes
      this.activeUploads.delete(fileId);
    } else {
      socket.emit("upload_error", {
        fileId,
        error: "Impossible de mettre en pause l'upload",
        code: "PAUSE_ERROR",
      });
    }
  }

  /**
   * Reprend un téléchargement en pause
   * @param {string} fileId - L'ID du fichier
   * @param {Socket} socket - L'instance de socket
   */
  resumeUpload(fileId, socket) {
    // Vérifier si l'upload est déjà actif
    if (this.activeUploads.has(fileId)) {
      return socket.emit("upload_error", {
        fileId,
        error: "L'upload est déjà actif",
        code: "ALREADY_ACTIVE",
      });
    }

    // Vérifier si l'upload existe dans les uploads persistants
    const persistentUpload = this.persistentUploads.get(fileId);
    if (!persistentUpload) {
      return socket.emit("upload_error", {
        fileId,
        error: "Upload non trouvé",
        code: "UPLOAD_NOT_FOUND",
      });
    }

    // Charger les chunks déjà reçus
    const buffer = this.loadPersistentChunks(
      fileId,
      persistentUpload.totalChunks
    );

    // Réactiver l'upload
    this.activeUploads.set(fileId, {
      ...persistentUpload,
      buffer,
      receivedChunks: new Set(persistentUpload.receivedChunks),
      socket,
      resumedAt: Date.now(),
      lastActivity: Date.now(),
      isPaused: false,
    });

    // Informer le client
    socket.emit("upload_resumed", {
      fileId,
      receivedChunks: Array.from(persistentUpload.receivedChunks),
      progress: Math.floor(
        (persistentUpload.receivedChunks.size / persistentUpload.totalChunks) *
          100
      ),
    });
  }

  /**
   * Gère la réception d'un morceau de fichier
   * @param {Socket} socket - L'instance de socket
   * @param {Object} data - Les données du chunk (fileId, index, data)
   */
  async handleFileChunk(socket, { fileId, index, data }) {
    try {
      const upload = this.activeUploads.get(fileId);

      // Vérifier si l'upload existe
      if (!upload) {
        return socket.emit("upload_error", {
          fileId,
          error: "Upload non trouvé",
          code: "UPLOAD_NOT_FOUND",
        });
      }

      // Mettre à jour le timestamp d'activité
      upload.lastActivity = Date.now();

      // Vérifier si le chunk a déjà été reçu
      if (upload.receivedChunks.has(index)) {
        return socket.emit("chunk_received", {
          fileId,
          index,
          duplicate: true,
        });
      }

      // Ajouter le chunk au buffer
      upload.buffer[index] = Buffer.from(data);
      upload.receivedChunks.add(index); //stocke les index des chunks reçus

      // Sauvegarder le chunk sur disque pour permettre la reprise
      try {
        const chunkDirPath = path.join(TEMP_UPLOAD_DIR, fileId);
        if (!fs.existsSync(chunkDirPath)) {
          fs.mkdirSync(chunkDirPath, { recursive: true });
        }
        fs.writeFileSync(
          path.join(chunkDirPath, `${index}.chunk`),
          upload.buffer[index]
        );
      } catch (err) {
        console.error(
          `Erreur lors de la sauvegarde du chunk ${index} pour ${fileId}:`,
          err
        );
      }

      // Envoyer un accusé de réception du chunk
      socket.emit("chunk_received", { fileId, index });

      // Sauvegarder périodiquement les métadonnées
      if (upload.receivedChunks.size % 10 === 0) {
        this.savePersistentUpload(fileId, upload);
      }

      // Vérifier si l'upload est complet
      if (upload.receivedChunks.size === upload.totalChunks) {
        await this.finalizeUpload(fileId, socket);
      } else {
        this.reportProgress(fileId, socket, upload);
      }
    } catch (error) {
      console.error("Erreur lors de la réception du chunk:", error);
      socket.emit("upload_error", {
        fileId,
        error: "Erreur lors du traitement du chunk",
        code: "CHUNK_PROCESSING_ERROR",
      });
    }
  }

  /**
   * Rapporte la progression du téléchargement au client
   * @param {string} fileId - L'ID du fichier
   * @param {Socket} socket - L'instance de socket
   * @param {Object} upload - Les données d'upload
   */
  reportProgress(fileId, socket, upload) {
    // Optimisation: rapporter la progression à intervalles réguliers
    if (
      upload.receivedChunks.size % PROGRESS_REPORT_INTERVAL === 0 ||
      upload.receivedChunks.size === Math.floor(upload.totalChunks / 2)
    ) {
      const progress = Math.floor(
        (upload.receivedChunks.size / upload.totalChunks) * 100
      );

      socket.emit("upload_progress", {
        fileId,
        received: upload.receivedChunks.size,
        total: upload.totalChunks,
        progress,
        elapsedTime: Date.now() - upload.startTime,
      });
    }
  }

  /**
   * Finalise le téléchargement et traite le fichier
   * @param {string} fileId - L'ID du fichier
   * @param {Socket} socket - L'instance de socket
   */
  async finalizeUpload(fileId, socket) {
    const upload = this.activeUploads.get(fileId);
    if (!upload) return;

    try {
      // Traiter le média
      const fileUploadedData = await handleMediaUpload(socket, {
        fileName: upload.fileName,
        mimeType: upload.mimeType,
        buffer: upload.buffer,
        mediaDuration: upload.mediaDuration,
      });

      // Stocker les données du fichier uploadé pour référence future
      const uploadResult = {
        fileId,
        fileName: upload.fileName,
        mediaPath: fileUploadedData.mediaPath,
        mediaSize: fileUploadedData.mediaSize,
        mediaDuration: fileUploadedData.mediaDuration,
        uploadTime: Date.now() - upload.startTime,
        completedAt: new Date(),
      };

      //ajouter le resultat dans activeUploads
     // Object.assign(upload, uploadResult); //très important car j'ai besoin d'un getter pour récupérer ces informations utiles

      // Confirmer que l'upload est terminé
      socket.emit(`upload_complete:${fileId}`, {
        ...uploadResult,
        processingTime: uploadResult.uploadTime,
      });

      /*  // Supprimer les données persistantes
      this.removePersistentUpload(fileId);

      // Libérer la mémoire
      this.activeUploads.delete(fileId); */

      return uploadResult;
    } catch (error) {
      console.error("Erreur lors du traitement du fichier:", error);
      socket.emit("upload_error", {
        fileId,
        error: error.message,
        code: error.code || "PROCESSING_ERROR",
      });

      // Ne pas supprimer les données persistantes en cas d'erreur
      // pour permettre une nouvelle tentative

      // Libérer la mémoire active
      this.activeUploads.delete(fileId);
      return null;
    }
  }

  /**
   * Annule un téléchargement en cours
   * @param {string} fileId - L'ID du fichier à annuler
   * @param {Socket} socket - L'instance de socket
   */
  cancelUpload(fileId, socket) {
    if (this.activeUploads.has(fileId) || this.persistentUploads.has(fileId)) {
      // Supprimer les données persistantes
      this.removePersistentUpload(fileId);

      // Supprimer de la mémoire active
      this.activeUploads.delete(fileId);

      socket.emit("upload_cancelled", { fileId });
    } else {
      socket.emit("upload_error", {
        fileId,
        error: "Upload non trouvé",
        code: "UPLOAD_NOT_FOUND",
      });
    }
  }

  /**
   * Gère la déconnexion d'un socket
   * @param {Socket} socket - L'instance de socket déconnectée
   */
  handleDisconnect(socket) {
    // Mettre en pause tous les uploads actifs de ce socket
    for (const [fileId, upload] of this.activeUploads.entries()) {
      if (upload.socket.id === socket.id) {
        // Sauvegarder l'état pour permettre la reprise
        this.savePersistentUpload(fileId, upload);

        // Libérer la mémoire active
        this.activeUploads.delete(fileId);
      }
    }
  }

  /**
   * Nettoie les uploads inactifs
   */
  cleanupStaleUploads() {
    const now = Date.now();

    // Nettoyer les uploads actifs inactifs
    for (const [fileId, upload] of this.activeUploads.entries()) {
      if (now - upload.lastActivity > CHUNK_TIMEOUT) {
        try {
          // Sauvegarder l'état pour permettre la reprise
          this.savePersistentUpload(fileId, upload);

          upload.socket.emit("upload_paused", {
            fileId,
            receivedChunks: upload.receivedChunks.size,
            totalChunks: upload.totalChunks,
            progress: Math.floor(
              (upload.receivedChunks.size / upload.totalChunks) * 100
            ),
            reason: "INACTIVITY",
          });
        } catch (e) {
          // Le socket peut être déjà déconnecté
        }
        this.activeUploads.delete(fileId);
      }
    }

    // Nettoyer les uploads persistants très anciens (7 jours)
    const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
    for (const [fileId, upload] of this.persistentUploads.entries()) {
      if (now - upload.lastActivity > ONE_WEEK) {
        this.removePersistentUpload(fileId);
      }
    }
  }

  /**
   * Vérifie si un upload est toujours actif
   * @param {string} fileId - L'ID du fichier
   * @returns {boolean} - Vrai si l'upload est actif
   */
  isUploadActive(fileId) {
    return this.activeUploads.has(fileId);
  }

  /**
   * Vérifie si un upload est en pause
   * @param {string} fileId - L'ID du fichier
   * @returns {boolean} - Vrai si l'upload est en pause
   */
  isUploadPaused(fileId) {
    return (
      this.persistentUploads.has(fileId) && !this.activeUploads.has(fileId)
    );
  }

  /**
   * Récupère des informations sur un upload en cours
   * @param {string} fileId - L'ID du fichier
   * @returns {Object|null} - Les informations de l'upload ou null
   */
  getUploadInfo(fileId, metadata) {
    const upload = this.activeUploads.get(fileId);
    if (upload) {
      return {
        fileId,
        fileName: upload.fileName,
        mimeType: upload.mimeType,
        progress: Math.floor(
          (upload.receivedChunks.size / upload.totalChunks) * 100
        ),
        mediaPath: upload.mediaPath,
        mediaSize: upload.mediaSize,
        mediaDuration: upload.mediaDuration,
        startTime: upload.startTime,
        elapsedTime: Date.now() - upload.startTime,
        lastActivity: upload.lastActivity,
        receivedChunks: upload.receivedChunks.size,
        totalChunks: upload.totalChunks,
        isPaused: false,
        completedAt: upload.completedAt,
        resumedAt: upload.resumedAt,
        ...metadata,
      };
    }

/*     // Vérifier les uploads en pause
    const pausedUpload = this.persistentUploads.get(fileId);
    if (pausedUpload) {
      return {
        fileId,
        fileName: pausedUpload.fileName,
        mimeType: pausedUpload.mimeType,
        progress: Math.floor(
          (pausedUpload.receivedChunks.size / pausedUpload.totalChunks) * 100
        ),
        lastActivity: pausedUpload.lastActivity,
        receivedChunks: pausedUpload.receivedChunks.size,
        totalChunks: pausedUpload.totalChunks,
        isPaused: true,
        ...metadata,
      };
    }
    
    if (Object.keys(metadata).length > 0) {
      return {
        fileId,
        ...metadata,
      };
    } */

    return null;
  }
}

export default UploadService;
