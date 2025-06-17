import User from '../models/user.model.js';
import Notification from '../models/notification.model.js';
import { dataParse } from '../utils/validator.js';
import { createUser, getNearbyUsers, getUserProfile, resendSmsVerificationCode, updateLocation, updateUserProfile, verifyUserSMS } from '../controllers/userController.js';
/* import { notifyNearbyUsers } from '../services/notificationService.js';
import { calculateDistance } from '../utils/geoUtils.js';
 */
/**
 * Gestionnaire d'événements Socket.io pour les utilisateurs
 * @param {Object} io - Instance Socket.io
 */
export default function userHandlers(io, socket) {
  /* socket.on("verification:code", async (data) => {
    try {
      await verifyUserSMS(socket, data);
    } catch (error) {
      console.error(`Erreur lors de la vérification de l'utilisateur: ${error.message}`);
      socket.emit('user:error', { message: 'Erreur interne du serveur' });
    }
  }); */
  socket.on("verification:code", async (data) => {
    try {
      const { deviceId, code , phoneNumber } = dataParse(data);
      await verifyUserSMS(socket, code, deviceId, phoneNumber);
    }
    catch (error) {
      console.error(`Erreur lors de la vérification de l'utilisateur: ${error.message}`);
      socket.emit('user:error', { message: 'Erreur interne du serveur' });
    }
  });
  
  socket.on("resent:verification_code", async (data) => {
    try {
      const { phone } = dataParse(data);
      await resendSmsVerificationCode(socket, phone);
    }
    catch (error) {
      console.error(`Erreur lors de la vérification de l'utilisateur: ${error.message}`);
      socket.emit('user:error', { message: 'Erreur interne du serveur' });
    }
  });
  // Écoute de l'événement de création d'utilisateur
  socket.on('create_user', async (userData) => {
    try {
      await createUser(socket, dataParse(userData));
    } catch (error) {
      console.error(`Erreur globale: ${error.message}`);
      socket.emit('user:error', { message: 'Erreur interne du serveur' });
    }
  });

  socket.on("get_user_profile", async (userIdToGetProfile) => {
    await getUserProfile(socket, userIdToGetProfile);
  });

  socket.on("update_user_profile", async (dataToUpdate) => {
    await updateUserProfile(socket, dataParse(dataToUpdate));
  });

  socket.on("get_nearby_users", async (maxRadius) => {
    await getNearbyUsers(socket, maxRadius);
  });

  socket.on("update_user_location", async (locationData) => {
    await updateLocation(socket, dataParse(locationData));
  });

  // Mettre à jour la position de l'utilisateur
  socket.on('update-location', async (data) => {
    try {
      const { userId, coordinates, address = null } = data;

      // Valider les données
      if (!userId || !coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
        return socket.emit('error', { message: 'Données de localisation invalides' });
      }

      // Mettre à jour la position de l'utilisateur
      const updatedUser = await User.findByIdAndUpdate(
        userId,
        {
          'location.coordinates': coordinates,
          'location.address': address,
          'lastLocation.coordinates': coordinates,
          'lastLocation.updatedAt': new Date()
        },
        { new: true }
      );

      if (!updatedUser) {
        return socket.emit('error', { message: 'Utilisateur non trouvé' });
      }

      // Informer l'utilisateur que sa position a été mise à jour
      socket.emit('location-updated', {
        success: true,
        location: updatedUser.location
      });

      // Réjoindre les salles géographiques
      joinGeoRooms(socket, coordinates);

      // Notifier les utilisateurs à proximité (si l'utilisateur n'est pas en mode discret)
      if (!updatedUser.profile.isShyMode) {
        const nearbyRoom = `geo:${Math.floor(coordinates[0])},${Math.floor(coordinates[1])}`;
        socket.to(nearbyRoom).emit('user-nearby', {
          userId: updatedUser._id,
          pseudo: updatedUser.userPseudo,
          location: {
            coordinates: updatedUser.location.coordinates
          },
          visibility: updatedUser.profile.visibility
        });
      }
    } catch (error) {
      console.error('Erreur lors de la mise à jour de la localisation:', error);
      socket.emit('error', { message: 'Erreur de serveur lors de la mise à jour de la localisation' });
    }
  });

  // Rechercher des utilisateurs à proximité
  socket.on('find-nearby-users', async (data) => {
    try {
      const { userId, coordinates, radius = 100, excludeShyMode = true } = data;

      // Valider les données
      if (!userId || !coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
        return socket.emit('error', { message: 'Données de recherche invalides' });
      }

      // Construire la requête
      const query = {
        _id: { $ne: userId }, // Exclure l'utilisateur lui-même
        'location.coordinates': {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: coordinates
            },
            $maxDistance: radius // en mètres
          }
        }
      };

      // Exclure les utilisateurs en mode discret si demandé
      if (excludeShyMode) {
        query['profile.isShyMode'] = { $ne: true };
      }

      // Trouver les utilisateurs à proximité
      const nearbyUsers = await User.find(query)
        .select('userPseudo profile.photo profile.visibility location lastConnection')
        .limit(50);

      // Filtrer en fonction de la visibilité
      const filtered = nearbyUsers.filter(user => {
        // Si le profil est public, on l'inclut toujours
        if (user.profile.visibility === 'public') return true;

        // Si on a d'autres règles de visibilité à appliquer (amis, etc.)
        // À implémenter selon les besoins

        return false;
      });

      socket.emit('nearby-users', {
        users: filtered,
        count: filtered.length,
        radius: radius
      });
    } catch (error) {
      console.error('Erreur lors de la recherche d\'utilisateurs à proximité:', error);
      socket.emit('error', { message: 'Erreur de serveur lors de la recherche d\'utilisateurs' });
    }
  });

  // Signaler un utilisateur comme vu
  socket.on('profile-viewed', async (data) => {
    try {
      const { viewerId, profileId } = data;

      if (!viewerId || !profileId) {
        return socket.emit('error', { message: 'Informations de visionnage incomplètes' });
      }

      // Mettre à jour le profil avec le nouveau spectateur
      const user = await User.findByIdAndUpdate(
        profileId,
        {
          $push: {
            'profile.profileViewers': {
              userId: viewerId,
              viewedAt: new Date()
            }
          }
        },
        { new: true }
      );

      if (!user) {
        return socket.emit('error', { message: 'Utilisateur non trouvé' });
      }

      // Créer une notification pour l'utilisateur dont le profil est vu
      const viewerUser = await User.findById(viewerId).select('userPseudo');

      if (viewerUser) {
        const notification = new Notification({
          recipient: profileId,
          sender: viewerId,
          type: 'status_view',
          title: 'Nouveau visiteur sur votre profil',
          message: `${viewerUser.userPseudo} a consulté votre profil`,
          relatedEntity: {
            entityType: 'User',
            entityId: viewerId
          },
          priority: 'normal'
        });

        await notification.save();

        // Émettre la notification en temps réel
        io.to(`user:${profileId}`).emit('new-notification', notification);
      }

      socket.emit('profile-view-recorded', { success: true });
    } catch (error) {
      console.error('Erreur lors de l\'enregistrement de la vue du profil:', error);
      socket.emit('error', { message: 'Erreur de serveur lors de l\'enregistrement de la vue' });
    }
  });

  // Activer/désactiver le mode discret
  socket.on('toggle-shy-mode', async (data) => {
    try {
      const { userId, isShyMode } = data;

      if (!userId) {
        return socket.emit('error', { message: 'ID utilisateur manquant' });
      }

      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { 'profile.isShyMode': isShyMode },
        { new: true }
      );

      if (!updatedUser) {
        return socket.emit('error', { message: 'Utilisateur non trouvé' });
      }

      socket.emit('shy-mode-updated', {
        success: true,
        isShyMode: updatedUser.profile.isShyMode
      });
    } catch (error) {
      console.error('Erreur lors de la mise à jour du mode discret:', error);
      socket.emit('error', { message: 'Erreur de serveur lors de la mise à jour du mode discret' });
    }
  });

  // Changer la visibilité du profil
  socket.on('change-visibility', async (data) => {
    try {
      const { userId, visibility } = data;

      if (!userId || !['public', 'private', 'friends'].includes(visibility)) {
        return socket.emit('error', { message: 'Données de visibilité invalides' });
      }

      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { 'profile.visibility': visibility },
        { new: true }
      );

      if (!updatedUser) {
        return socket.emit('error', { message: 'Utilisateur non trouvé' });
      }

      socket.emit('visibility-updated', {
        success: true,
        visibility: updatedUser.profile.visibility
      });
    } catch (error) {
      console.error('Erreur lors du changement de visibilité:', error);
      socket.emit('error', { message: 'Erreur de serveur lors du changement de visibilité' });
    }
  });
}

// Utilitaire pour rejoindre des salles géographiques
function joinGeoRooms(socket, coordinates) {
  // Quitter d'abord toutes les salles géographiques
  Object.keys(socket.rooms).forEach(room => {
    if (room.startsWith('geo:')) {
      socket.leave(room);
    }
  });

  // Rejoindre la salle géographique principale (basée sur les coordonnées arrondies)
  const mainGeoRoom = `geo:${Math.floor(coordinates[0])},${Math.floor(coordinates[1])}`;
  socket.join(mainGeoRoom);

  // Rejoindre des salles à différentes échelles si nécessaire
  // Par exemple, pour une précision de 0.1 degré
  const subGeoRoom = `geo:${(Math.floor(coordinates[0] * 10) / 10).toFixed(1)},${(Math.floor(coordinates[1] * 10) / 10).toFixed(1)}`;
  socket.join(subGeoRoom);
}