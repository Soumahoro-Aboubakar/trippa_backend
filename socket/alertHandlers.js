import Alert from '../models/Alert.js';
import User from '../models/User.js';
import { calculateDistance } from '../utils/geoUtils.js';
import { notifyUsersInRadius } from '../services/notificationService.js';
import mediaService from '../services/mediaService.js';

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
      if (alertData.media) {
        const { buffer, mimetype, originalname } = alertData.media;
        mediaUrl = await mediaService.uploadMedia(buffer, {
          fileName: `alert_${socket.userId}_${Date.now()}_${originalname}`,
          contentType: mimetype,
          folder: 'alerts'
        });
        delete alertData.media; // Supprimer le buffer du fichier pour éviter de le stocker en DB
      }

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

      // Notifier les utilisateurs dans le rayon spécifié
      const notifiedUsers = await notifyUsersInRadius(
        newAlert.location.coordinates,
        newAlert.radius,
        {
          type: 'alert_nearby',
          title: `Alerte: ${newAlert.type}`,
          message: newAlert.description.substring(0, 100) + (newAlert.description.length > 100 ? '...' : ''),
          relatedEntity: {
            entityType: 'Alert',
            entityId: newAlert._id
          },
          priority: newAlert.type === 'danger' ? 'urgent' : 'high',
        }
      );

      // Diffuser l'alerte à tous les utilisateurs concernés via socket
      io.to(`radius_${Math.floor(newAlert.location.coordinates[0])}_${Math.floor(newAlert.location.coordinates[1])}_${Math.ceil(newAlert.radius/1000)}`).emit('newAlert', {
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
      const roomName = `radius_${Math.floor(coordinates[0])}_${Math.floor(coordinates[1])}_${Math.ceil(radius/1000)}`;
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