import express, { json } from 'express';
import { createServer } from 'http';
import socketIo from 'socket.io';
import cors from 'cors';
import { UploadService } from './upload-service';

const app = express();
const server = createServer(app);

// Configuration CORS pour Socket.IO
const io = socketIo(server, {
  cors: {
    origin: "*", // À adapter selon vos besoins
    methods: ["GET", "POST"],
    credentials: true
  },
  maxHttpBufferSize: 1e8 // 100MB pour les gros chunks
});

app.use(cors());
app.use(json({ limit: '50mb' }));

// Fonction de traitement des médias (à adapter selon vos besoins avec Backblaze B2)
async function handleMediaUpload(fileBuffer, metadata) {
  try {
    console.log(`Processing uploaded file: ${metadata.fileName} (${metadata.fileSize} bytes)`);
    
    // Exemple d'intégration avec Backblaze B2
    // const B2 = require('backblaze-b2');
    // const b2 = new B2({
    //   applicationKeyId: process.env.B2_KEY_ID,
    //   applicationKey: process.env.B2_APPLICATION_KEY
    // });
    
    // await b2.authorize();
    // const uploadResult = await b2.uploadFile({
    //   bucketId: process.env.B2_BUCKET_ID,
    //   fileName: metadata.fileName,
    //   data: fileBuffer,
    //   mime: metadata.mimeType
    // });

    // Pour cet exemple, on simule juste le traitement
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const result = {
      fileId: metadata.fileId,
      fileName: metadata.fileName,
      fileSize: metadata.fileSize,
      mimeType: metadata.mimeType,
      uploadedAt: new Date().toISOString(),
      // url: uploadResult.data.fileUrl, // URL Backblaze B2
      url: `http://localhost:3000/files/${metadata.fileId}`, // URL temporaire
      status: 'processed'
    };

    console.log(`File processed successfully: ${metadata.fileName}`);
    return result;

  } catch (error) {
    console.error('Error processing media upload:', error);
    throw new Error(`Failed to process upload: ${error.message}`);
  }
}

// Initialiser le service d'upload
const uploadService = new UploadService(io, handleMediaUpload);

// Routes API optionnelles pour la gestion des uploads
app.get('/api/uploads/:userId', async (req, res) => {
  try {
    const uploads = uploadService._getUserUploads(req.params.userId);
    res.json({ success: true, uploads });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/uploads/:fileId', async (req, res) => {
  try {
    const session = uploadService.sessions.get(req.params.fileId);
    if (session) {
      await session.cancel();
      uploadService.sessions.delete(req.params.fileId);
      res.json({ success: true, message: 'Upload cancelled' });
    } else {
      res.status(404).json({ success: false, error: 'Upload not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Route de santé
app.get('/health', (req, res) => {
  const activeSessions = uploadService.sessions.size;
  const connectedUsers = uploadService.userSockets.size;
  
  res.json({
    status: 'healthy',
    activeSessions,
    connectedUsers,
    uptime: process.uptime()
  });
});

// Gestion propre de l'arrêt du serveur
process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down gracefully...');
  
  await uploadService.shutdown();
  
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  
  await uploadService.shutdown();
  
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Gestion des erreurs non catchées
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Upload server running on port ${PORT}`);
  console.log(`Socket.IO server ready`);
});

// Exemples d'événements Socket.IO côté serveur pour debug
io.on('connection', (socket) => {
  console.log(`New connection: ${socket.id}`);
  
  // Événement de test
  socket.on('ping', () => {
    socket.emit('pong', { timestamp: Date.now() });
  });
});

export default { app, server, io, uploadService };