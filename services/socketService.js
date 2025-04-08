import Message from '../models/message.model.js';
import User from '../models/user.model.js';
import Group from '../models/group.model.js';
import { updateUserLocation } from './geoService.js';

// Stocker les relations socket-utilisateur
const activeUsers = new Map();

export const setupSocketHandlers = (io) => {
  io.on('connection', (socket) => {
  //  console.log(`Utilisateur connecté: ${socket} (${socket.id})`);

    // Ajouter l'utilisateur à la liste des utilisateurs actifs
    activeUsers.set(socket.userData._id.toString(), socket.id);


   /*  // Mettre à jour le statut de connexion de l'utilisateur
    updateUserConnectionStatus(socket.user.id, true);
 */

   /*  // Rejoindre les canaux des groupes de l'utilisateur
    joinUserGroups(socket);
 */
    
    // Événement de mise à jour de localisation
    socket.on('user:updateLocation', async (data) => {
      try {
        const { coordinates, address } = data;
        await updateUserLocation(socket.user.id, coordinates, address);

        // Émettre un événement pour informer que la localisation a été mise à jour
        socket.emit('user:locationUpdated', { success: true });
      } catch (error) {
        console.error('Erreur lors de la mise à jour de la localisation:', error);
        socket.emit('error', { message: 'Échec de la mise à jour de la localisation' });
      }
    });

    // Événement d'envoi de message
    socket.on('message:send', async (data) => {
      try {
        const { receiverId, groupId, content, type, isAnonymous, mediaPath } = data;

        const newMessage = new Message({
          sender: socket.user.id,
          content,
          type: type || 'text',
          isAnonymous: isAnonymous || false,
          mediaPath,
          mediaDuration: data.mediaDuration,
          mediaSize: data.mediaSize
        });

        // Message privé
        if (receiverId) {
          newMessage.receiver = receiverId;
          // Message privé (suite)
          await newMessage.save();

          // Envoyer le message au destinataire s'il est connecté
          const receiverSocketId = activeUsers.get(receiverId.toString());
          if (receiverSocketId) {
            io.to(receiverSocketId).emit('message:received', {
              message: await newMessage.populate('sender', 'userPseudo profile.photo')
            });
          }

          // Confirmer l'envoi à l'expéditeur
          socket.emit('message:sent', { message: newMessage });
        }
        // Message de groupe
        else if (groupId) {
          newMessage.group = groupId;
          await newMessage.save();

          // Envoyer à tous les membres du groupe
          io.to(`group:${groupId}`).emit('message:group', {
            message: await newMessage.populate('sender', 'userPseudo profile.photo')
          });
        } else {
          throw new Error('Destinataire ou groupe non spécifié');
        }
      } catch (error) {
        console.error('Erreur lors de l\'envoi du message:', error);
        socket.emit('error', { message: 'Échec de l\'envoi du message' });
      }
    });

    // Marquer un message comme lu
    socket.on('message:markAsRead', async (messageId) => {
      try {
        const message = await Message.findById(messageId);
        if (!message) {
          return socket.emit('error', { message: 'Message non trouvé' });
        }

        if (message.receiver.toString() === socket.user.id) {
          message.isRead = true;
          await message.save();

          // Informer l'expéditeur que le message a été lu
          const senderSocketId = activeUsers.get(message.sender.toString());
          if (senderSocketId) {
            io.to(senderSocketId).emit('message:read', { messageId });
          }
        }
      } catch (error) {
        console.error('Erreur lors du marquage du message comme lu:', error);
        socket.emit('error', { message: 'Échec du marquage du message' });
      }
    });

    // Rejoindre un groupe
    socket.on('group:join', async (groupId) => {
      try {
        const group = await Group.findById(groupId);
        if (!group) {
          return socket.emit('error', { message: 'Groupe non trouvé' });
        }

        // Vérifier si l'utilisateur est membre du groupe
        if (!group.members.includes(socket.user.id)) {
          // Ajouter l'utilisateur au groupe
          group.members.push(socket.user.id);
          await group.save();
        }

        // Rejoindre le canal socket du groupe
        socket.join(`group:${groupId}`);
        socket.emit('group:joined', { groupId });

        // Informer les autres membres du groupe
        socket.to(`group:${groupId}`).emit('group:memberJoined', {
          groupId,
          user: {
            id: socket.user.id,
            userPseudo: socket.user.userPseudo
          }
        });
      } catch (error) {
        console.error('Erreur lors de la jointure au groupe:', error);
        socket.emit('error', { message: 'Échec de la jointure au groupe' });
      }
    });

    // Créer une alerte
    socket.on('alert:create', async (alertData) => {
      try {
        const { type, description, coordinates, radius, mediaUrl } = alertData;

        // Logique de création d'alerte déplacée vers alertController
        // Appel au controller via une fonction importée
        const alert = await createAlert({
          creator: socket.user.id,
          type,
          description,
          location: {
            type: 'Point',
            coordinates
          },
          radius: radius || 1000,
          mediaUrl
        }, io);

        socket.emit('alert:created', { alert });
      } catch (error) {
        console.error('Erreur lors de la création de l\'alerte:', error);
        socket.emit('error', { message: 'Échec de la création de l\'alerte' });
      }
    });

    // Visualisation d'un statut
    socket.on('status:view', async (data) => {
      try {
        const { statusId, duration } = data;
        await recordStatusView(statusId, socket.user.id, duration);
        socket.emit('status:viewed', { statusId });
      } catch (error) {
        console.error('Erreur lors de l\'enregistrement de la vue du statut:', error);
        socket.emit('error', { message: 'Échec de l\'enregistrement de la vue' });
      }
    });

    // Déconnexion
    socket.on('disconnect', () => {
      console.log(`Utilisateur déconnecté: ${socket.user.userPseudo} (${socket.user.id})`);

      // Supprimer l'utilisateur de la liste des utilisateurs actifs
      activeUsers.delete(socket.user.id.toString());

      // Mettre à jour le statut de connexion de l'utilisateur
      updateUserConnectionStatus(socket.user.id, false);
    });
  });
};

// Fonction pour rejoindre les canaux des groupes de l'utilisateur
const joinUserGroups = async (socket) => {
  try {
    // Trouver tous les groupes dont l'utilisateur est membre
    const groups = await Group.find({ members: socket.user.id });

    // Rejoindre chaque groupe
    groups.forEach(group => {
      socket.join(`group:${group._id}`);
    });

    console.log(`${socket.user.userPseudo} a rejoint ${groups.length} groupes`);
  } catch (error) {
    console.error('Erreur lors de la jointure aux groupes:', error);
  }
};

// Mettre à jour le statut de connexion de l'utilisateur
const updateUserConnectionStatus = async (userId, isConnected) => {
  try {
    let userStatus = isConnected ? {
      isOnline: true,
    } : {
      isOnline: false,
      lastConnection: new Date()
    };
    await User.findByIdAndUpdate(userId, userStatus);
  } catch (error) {
    console.error('Erreur lors de la mise à jour du statut de connexion:', error);
  }
};

// Fonction pour enregistrer la visualisation d'un statut
const recordStatusView = async (statusId, userId, duration) => {
  try {
    const Status = mongoose.model('Status');
    const status = await Status.findById(statusId);

    if (!status) {
      throw new Error('Statut non trouvé');
    }

    // Vérifier si l'utilisateur a déjà vu ce statut
    const viewIndex = status.views.findIndex(view => view.user.toString() === userId.toString());

    if (viewIndex === -1) {
      // Première vue de l'utilisateur
      status.views.push({
        user: userId,
        viewedAt: [{
          duration: duration || 0,
          type: new Date()
        }]
      });
    } else {
      // Ajouter une nouvelle visualisation
      status.views[viewIndex].viewedAt.push({
        duration: duration || 0,
        type: new Date()
      });
    }

    // Mettre à jour les statistiques
    status.totalViews = status.views.length;

    await status.save();
    return status;
  } catch (error) {
    console.error('Erreur lors de l\'enregistrement de la vue du statut:', error);
    throw error;
  }
};

export const getOnlineUsers = () => {
  return Array.from(activeUsers.keys());
};

export const isUserOnline = (userId) => {
  return activeUsers.has(userId.toString());
};

export const getUserSocketId = (userId) => {
  return activeUsers.get(userId.toString());
};

