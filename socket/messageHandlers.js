import Alert from '../models/alert.model.js';
import User from '../models/user.model.js';
//import { notifyUsersInRadius } from '../services/notificationService.js';
import { handleMediaUpload } from '../services/mediaService.js';
import Room from '../models/room.model.js';
import Message from '../models/message.model.js';
import { dataParse } from '../utils/validator.js';
import mongoose from 'mongoose';
import { getUserSocketId } from './UserFunctionHandler.js';
import { getUnreadMessages } from '../services/messageService.js';
import Notification from '../models/notification.model.js';
const activeUploads = new Map();

function generatePrivateAccessCode(userId1, userId2) {
  const sortedIds = [userId1, userId2].sort();
  return `${sortedIds[0]}_${sortedIds[1]}`;
}

// Fonction auxiliaire pour vérifier/créer la room


export default function alertHandlers(io, socket) {
  // Créer une nouvelle alerte
  socket.on('createAlert', async (alertData, callback) => {
    try {
      // Récupérer les informations de l'utilisateur
      const user = await User.findById(socket.userId);
      if (!user) {
        return callback({ error: 'Utilisateur non trouvé' });
      }

      // Traiter le média s'il existe
      let mediaUrl = null;
        // Créer la nouvelle alerte
      const newAlert = new Alert({
        creator: socket.userId,
        type: alertData.type,
        description: alertData.description,
        location: alertData.location,
        radius: alertData.radius || 1000,
        mediaUrl: mediaUrl,
      });

      await newAlert.save();
  io.to(`radius_${Math.floor(newAlert.location.coordinates[0])}_${Math.floor(newAlert.location.coordinates[1])}_${Math.ceil(newAlert.radius / 1000)}`).emit('newAlert', {
        alertId: newAlert._id,
        type: newAlert.type,
        description: newAlert.description,
        location: newAlert.location,
        createdAt: newAlert.createdAt,
        mediaUrl: newAlert.mediaUrl,
        creator: {
          id: user._id,
          userPseudo: user.userPseudo
        }
      });

      callback({ success: true, alertId: newAlert._id, notifiedUsers: notifiedUsers.length });
    } catch (error) {
      console.error('Erreur lors de la création d\'une alerte:', error);
      callback({ error: 'Impossible de créer l\'alerte: ' + error.message });
    }
  });

  // Confirmer une alerte (signaler qu'elle est réelle)
  socket.on('confirmAlert', async (data, callback) => {
    try {
      const { alertId } = data;

      const alert = await Alert.findById(alertId);
      if (!alert) {
        return callback({ error: 'Alerte non trouvée' });
      }

      // Vérifier si l'utilisateur a déjà confirmé cette alerte
      const alreadyConfirmed = alert.confirmations.some(
        confirmation => confirmation.user.toString() === socket.userId
      );

      if (!alreadyConfirmed) {
        alert.confirmations.push({ user: socket.userId });
        await alert.save();

        // Émettre un événement pour mettre à jour les compteurs
        io.to(`alert_${alertId}`).emit('alertConfirmation', {
          alertId,
          confirmationsCount: alert.confirmations.length
        });

        callback({ success: true, confirmationsCount: alert.confirmations.length });
      } else {
        callback({ error: 'Vous avez déjà confirmé cette alerte' });
      }
    } catch (error) {
      console.error('Erreur lors de la confirmation d\'une alerte:', error);
      callback({ error: 'Impossible de confirmer l\'alerte: ' + error.message });
    }
  });

  // S'abonner aux alertes dans une zone spécifique
  socket.on('subscribeToAreaAlerts', async (data, callback) => {
    try {
      const { coordinates, radius } = data;

      // Valider les coordonnées
      if (!coordinates || coordinates.length !== 2 || !radius) {
        return callback({ error: 'Coordonnées ou rayon invalides' });
      }

      // Mettre à jour la localisation de l'utilisateur
      await User.findByIdAndUpdate(socket.userId, {
        'lastLocation.coordinates': coordinates,
        'lastLocation.updatedAt': new Date()
      });

      // Rejoindre la salle correspondant à la zone géographique
      // Format: radius_longitude_latitude_radiusInKm
      const roomName = `radius_${Math.floor(coordinates[0])}_${Math.floor(coordinates[1])}_${Math.ceil(radius / 1000)}`;
      socket.join(roomName);

      // Récupérer les alertes actives dans cette zone
      const activeAlerts = await Alert.find({
        isActive: true,
        expireAt: { $gt: new Date() },
        'location.coordinates': {
          $near: {
            $geometry: {
              type: "Point",
              coordinates: coordinates
            },
            $maxDistance: radius
          }
        }
      }).populate('creator', 'userPseudo').limit(20);

      callback({
        success: true,
        roomName,
        activeAlerts: activeAlerts.map(alert => ({
          id: alert._id,
          type: alert.type,
          description: alert.description,
          location: alert.location,
          createdAt: alert.createdAt,
          confirmations: alert.confirmations.length,
          mediaUrl: alert.mediaUrl,
          creator: {
            id: alert.creator._id,
            userPseudo: alert.creator.userPseudo
          }
        }))
      });
    } catch (error) {
      console.error('Erreur lors de l\'abonnement aux alertes de zone:', error);
      callback({ error: 'Impossible de s\'abonner aux alertes: ' + error.message });
    }
  });

  // Se désabonner des alertes d'une zone
  socket.on('unsubscribeFromAreaAlerts', (data, callback) => {
    try {
      const { roomName } = data;
      socket.leave(roomName);
      callback({ success: true });
    } catch (error) {
      callback({ error: 'Erreur lors du désabonnement: ' + error.message });
    }
  });

  // Rechercher des alertes
  socket.on('searchAlerts', async (data, callback) => {
    try {
      const { coordinates, radius, type, limit = 20 } = data;

      const query = {
        isActive: true,
        expireAt: { $gt: new Date() }
      };

      if (coordinates && coordinates.length === 2) {
        query['location.coordinates'] = {
          $near: {
            $geometry: {
              type: "Point",
              coordinates
            },
            $maxDistance: radius || 5000 // 5km par défaut
          }
        };
      }

      if (type) {
        query.type = type;
      }

      const alerts = await Alert.find(query)
        .populate('creator', 'userPseudo')
        .limit(limit)
        .sort({ createdAt: -1 });

      callback({
        success: true,
        alerts: alerts.map(alert => ({
          id: alert._id,
          type: alert.type,
          description: alert.description,
          location: alert.location,
          createdAt: alert.createdAt,
          confirmations: alert.confirmations.length,
          mediaUrl: alert.mediaUrl,
          creator: {
            id: alert.creator._id,
            userPseudo: alert.creator.userPseudo
          }
        }))
      });
    } catch (error) {
      console.error('Erreur lors de la recherche d\'alertes:', error);
      callback({ error: 'Impossible de rechercher des alertes: ' + error.message });
    }
  });
}



export const socketMessageHandlers = (io, socket) => {
  async function ensureRoomExists(socket, upload) {

    // Si une room est déjà spécifiée, l'utiliser
    if (upload.room) {
      return { roomId: upload.room, isNew: false };
    }

    // Vérifier si une room privée existe déjà entre ces utilisateurs
    const accessCode = generatePrivateAccessCode(socket.userData._id, upload.receiver);
    const existingRoom = await Room.findOne({
      roomAccessCode: accessCode,
      isPrivate: true
    });

    if (existingRoom) {
      return { roomId: existingRoom._id, isNew: false };
    }

    // Créer une nouvelle room
    const room = new Room({
      members: [socket.userData._id, upload.receiver],
      isGroup: false,
      isPrivate: true,
      roomAccessCode: accessCode,
      creator: socket.userData._id
    });
    console.log("Pendant la creation", room);
    // Sauvegarder la room et mettre à jour les utilisateurs
    const [savedRoom, updatedSender, updatedReceiver] = await Promise.all([
      room.save(),
      User.findByIdAndUpdate(
        socket.userData._id,
        { $push: { rooms: room._id } },
        { new: true }
      ),
      User.findByIdAndUpdate(
        upload.receiver,
        { $push: { rooms: room._id } },
        { new: true }
      )
    ]);

    // Joindre les utilisateurs à la room
    socket.join(savedRoom._id);

    // Joindre le destinataire s'il est connecté
    if (global.connectedUsers.has(upload.receiver)) {
      const receiverSocketsId = global.connectedUsers.get(upload.receiver);
      const receiverSocket = io.sockets.sockets.get(receiverSocketsId);
      if (receiverSocket) {
        receiverSocket.join(savedRoom._id);
      }
    }

    return { roomId: savedRoom._id, isNew: true };
  }
/*  socket.on('start_upload', (metadata) => {
    // Initialiser l'upload avec toutes les métadonnées nécessaires
    activeUploads.set(metadata.fileId, {
      ...metadata, // fileID, fileName, mimeType, mediaType, messageType, targetId, content, isAnonymous, totalChunks, mediaDuration
      buffer: new Array(metadata.totalChunks), // Préallouer le tableau avec la taille exacte
      receivedChunks: new Set(),
      messageText: metadata.messageText,
      startTime: Date.now() // Ajouter un timestamp pour surveiller la durée de l'upload
    });

    // Confirmer le début de l'upload au client
    socket.emit('upload_started', { fileId: metadata.fileId });
  });

  socket.on('file_chunk', async ({ fileId, index, data }) => {
    const upload = activeUploads.get(fileId);

    // Vérifier si l'upload existe
    if (!upload) {
      return socket.emit('message:error', { error: 'Upload non trouvé' });
    }

    // Ajouter le chunk au buffer
    upload.buffer[index] = Buffer.from(data);
    upload.receivedChunks.add(index);

    // Envoyer un accusé de réception du chunk
    socket.emit('chunk_received', { fileId, index });

    // Vérifier si l'upload est complet
    if (upload.receivedChunks.size === upload.totalChunks) {
      try {
        // Traitement parallèle: vérifier/créer la room et traiter le média simultanément
        const [roomInfo, mediaInfo] = await Promise.all([
          ensureRoomExists(socket, upload),
          handleMediaUpload(socket, {
            fileName: upload.fileName,
            mimeType: upload.mimeType,
            buffer: upload.buffer,
            mediaDuration: upload.mediaDuration
          })
        ]);

        // Utiliser l'ID de la room obtenue
        const roomId = roomInfo.roomId;

        // Créer et sauvegarder le message
        const message = new Message({
          sender: socket.userData._id,
          room: roomId,
          type: upload.mediaType,
          content: upload.messageText,
          isAnonymous: upload.isAnonymous,
          ...mediaInfo
        });

        // Sauvegarder et peupler en une seule opération
        const savedMessage = await message.save();
        const populatedMessage = await Message.findById(savedMessage._id)
          .populate('sender', 'userPseudo profile.photo');

        // Diffuser le message
        io.to(roomId?.toString()).emit('new:message', populatedMessage);

        // Nettoyer les ressources
        activeUploads.delete(fileId);

        // Confirmer que l'upload est terminé
        socket.emit('upload_complete', {
          fileId,
          messageId: savedMessage._id,
          processingTime: Date.now() - upload.startTime
        });

      } catch (error) {
        console.error('Erreur lors du traitement du fichier:', error);
        socket.emit('message:error', {
          fileId,
          error: error.message,
          code: error.code || 'PROCESSING_ERROR'
        });

        // Nettoyage en cas d'erreur
        activeUploads.delete(fileId);
      }
    } else {
      // Informer le client de la progression
      if (upload.receivedChunks.size % 5 === 0 || upload.receivedChunks.size === Math.floor(upload.totalChunks / 2)) {
        socket.emit('upload_progress', {
          fileId,
          received: upload.receivedChunks.size,
          total: upload.totalChunks,
          progress: Math.floor((upload.receivedChunks.size / upload.totalChunks) * 100)
        });
      }
    }
  }); */



  socket.on('message:create', async (message) => {
    const messageData = dataParse(message);
    try {
      if (!message.room) {
        const roomInfo = await ensureRoomExists(socket, {
          receiver: messageData.receiver
        });
        messageData.room = roomInfo.roomId;
      }

      const newMessage = new Message({
        sender: socket.userData._id,
        ...messageData,
      });

      const savedMessage = await newMessage.save();
      const populatedMessage = await Message.findById(savedMessage._id)
        .populate('sender', 'userPseudo profile.photo');
      io.to(messageData.room?.toString()).emit('new:message', populatedMessage);

    } catch (error) {
      console.error('Erreur lors de l\'envoi du message texte:', error);
      socket.emit('message:error', { error: error.message });
    }
  });



  socket.on('fetchNewMessages', async ({ roomId }) => {
    const roomObjectId = new mongoose.Types.ObjectId(String(roomId));
    const userId = new mongoose.Types.ObjectId(String(socket.userData._id));

    try {
      const aggregationPipeline = [
        {
          $match: {
            room: roomObjectId,
            receivedBy: { $nin: [userId] }
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'sender',
            foreignField: '_id',
            as: 'sender'
          }
        },
        { $unwind: '$sender' },
        {
          $lookup: {
            from: 'rooms',
            localField: 'room',
            foreignField: '_id',
            as: 'room'
          }
        },
        { $unwind: '$room' },
        {
          $match: {
            $or: [
              { 'room.isPrivate': false },
              {
                'room.isPrivate': true,
                $expr: { $eq: ['$receiver', userId] }
              }
            ]
          }
        },
        {
          $project: {
            'sender.wallet': 0,
            'sender.profile.profileViewers': 0,
            'sender.profile.statusViewers': 0,
            'sender.statusShared': 0,
            'sender.phone': 0,
            'sender.email': 0,
            'room.members': 0,
            'room.wallet': 0,
            'receivedBy': 0,
            'seenBy': 0
          }
        },
        { $sort: { createdAt: 1 } }
      ];

      const userMessages = await Message.aggregate(aggregationPipeline);

      socket.emit('newMessages', userMessages);
    } catch (error) {
      console.error('Error:', error);
      socket.emit('fetchNewMessages:error', {
        error: error.message,
        code: error.code || 'DATABASE_ERROR'
      });
    }
  });

};

export const initializeAuthenticatedUser = async (socket, userId) => {
  const userData = await User.findOne({ _id: userId });

  if (!userData) {
    throw new Error('Utilisateur non trouvé');
  }

  socket.userData = {
    ...socket.userData,
    userName: userData.userPseudo,
    KSD: userData.KSD,
  };

  // Rejoindre toutes les rooms
  userData.rooms.forEach(roomId => {
    socket.join(roomId.toString());
  });

  // Récupérer les messages et notifications non lus
  await sendPendingCommunications(socket, userData);

  // Ajouter l'utilisateur à la liste des connectés
  if (!global.connectedUsers.has(userId)) {
    global.connectedUsers.set(userId, socket.id);
  }

  console.log(`Utilisateur connecté: ${userId}`);
  console.log(`Nombre d'utilisateurs connectés: ${global.connectedUsers.size}`);
};

export const sendPendingCommunications = async (socket, userData) => {
  try {
    const [messages, notifications, groupMessages] = await Promise.all([
      Message.find({ receiver: userData._id, status: 'SENT' }),
      Notification.find({ recipient: userData._id, status: "CREATED" }),
      getUnreadMessages(userData._id, userData.rooms)
    ]);

    if (messages.length > 0) socket.emit('newMessages', messages);
    if (notifications.length > 0) socket.emit('newNotifications', notifications);
    if (groupMessages.length > 0) socket.emit('newGroupMessages', groupMessages);

  } catch (error) {
    console.error('Erreur lors de la récupération des communications:', error);
    throw error;
  }
};

export const setupErrorHandlers = (socket) => {
  socket.on('connect_error', (error) => {
    console.error('Erreur de connexion:', error.message);

    if (error.message.includes('WebSocket')) {
      console.log('⚠️ Échec de WebSocket - Basculement vers polling...');
    }

    if (error.message.includes('timeout')) {
      console.log('⚠️ Délai de connexion dépassé');
    }
  });

  socket.on('reconnect', (attempt) => {
    console.log(`Reconnecté avec succès après ${attempt} tentative(s)`);
  });
  socket.on("disconnect", () => {
    global.connectedUsers.delete(socket.userData._id.toString());
  });
};
