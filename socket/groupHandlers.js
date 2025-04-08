import Group from '../models/group.model.js';
import User from '../models/user.model.js';
import Notification from '../models/notification.model.js';
import { dataParse } from '../utils/validator.js';
//import { notifyNearbyUsers } from '../services/notificationService.js';

/**
 * Gestionnaire d'événements Socket.io pour les groupes
 * @param {Object} io - Instance Socket.io
 */
export default function groupHandlers(io, socket) {
  // Rejoindre un groupe
  socket.on('join-group', async (data) => {
    try {
      const { userId, groupId } = data;
      
      if (!userId || !groupId) {
        return socket.emit('error', { message: 'Informations de groupe incomplètes' });
      }
      
      // Vérifier si le groupe existe
      const group = await Group.findById(groupId);
      if (!group) {
        return socket.emit('error', { message: 'Groupe introuvable' });
      }
      
      // Vérifier si l'utilisateur est déjà membre
      if (group.members.includes(userId)) {
        socket.join(`group:${groupId}`);
        return socket.emit('group-joined', { 
          success: true, 
          message: 'Déjà membre du groupe',
          group: group
        });
      }
      
      // Vérifier si le groupe est privé
      if (group.isPrivate) {
        return socket.emit('error', { message: 'Ce groupe est privé, une invitation est nécessaire' });
      }
      
      // Ajouter l'utilisateur au groupe
      const updatedGroup = await Group.findByIdAndUpdate(
        groupId,
        { $addToSet: { members: userId } },
        { new: true }
      ).populate('members', 'userPseudo profile.photo');
      
      // Rejoindre la salle socket du groupe
      socket.join(`group:${groupId}`);
      
      // Notifier les autres membres
      const user = await User.findById(userId).select('userPseudo profile.photo');
      if (user) {
        socket.to(`group:${groupId}`).emit('member-joined', {
          groupId,
          user: {
            _id: user._id,
            userPseudo: user.userPseudo,
            photo: user.profile?.photo
          }
        });
      }
      
      socket.emit('group-joined', { 
        success: true, 
        message: 'Vous avez rejoint le groupe',
        group: updatedGroup
      });
    } catch (error) {
      console.error('Erreur lors de la jonction au groupe:', error);
      socket.emit('error', { message: 'Erreur serveur lors de la jonction au groupe' });
    }
  });
  
  // Quitter un groupe
  socket.on('leave-group', async (data) => {
    try {
      const { userId, groupId } = data;
      
      if (!userId || !groupId) {
        return socket.emit('error', { message: 'Informations de groupe incomplètes' });
      }
      
      // Vérifier si le groupe existe
      const group = await Group.findById(groupId);
      if (!group) {
        return socket.emit('error', { message: 'Groupe introuvable' });
      }
      
      // Vérifier si l'utilisateur est membre
      if (!group.members.includes(userId)) {
        return socket.emit('error', { message: 'Vous n\'êtes pas membre de ce groupe' });
      }
      
      // Vérifier si l'utilisateur est administrateur
      const isAdmin = group.admins.includes(userId);
      
      // Si c'est le dernier admin, désigner un nouvel admin ou supprimer le groupe
      if (isAdmin && group.admins.length === 1 && group.admins[0].toString() === userId) {
        if (group.members.length > 1) {
          // Trouver un autre membre pour être admin
          const newAdminId = group.members.find(memberId => 
            memberId.toString() !== userId
          );
          
          await Group.findByIdAndUpdate(
            groupId,
            { 
              $pull: { members: userId, admins: userId },
              $addToSet: { admins: newAdminId }
            }
          );
        } else {
          // Supprimer le groupe s'il n'y a plus de membres
          await Group.findByIdAndDelete(groupId);
          socket.to(`group:${groupId}`).emit('group-deleted', { 
            groupId, 
            message: 'Le groupe a été supprimé' 
          });
          
          socket.emit('group-left', { 
            success: true, 
            message: 'Vous avez quitté le groupe et il a été supprimé',
            groupId
          });
          
          return;
        }
      } else {
        // Retirer simplement l'utilisateur du groupe
        await Group.findByIdAndUpdate(
          groupId,
          { 
            $pull: { members: userId },
            ...(isAdmin ? { $pull: { admins: userId } } : {})
          }
        );
      }
      
      // Quitter la salle socket du groupe
      socket.leave(`group:${groupId}`);
      
      // Notifier les autres membres
      socket.to(`group:${groupId}`).emit('member-left', {
        groupId,
        userId
      });
      
      socket.emit('group-left', { 
        success: true, 
        message: 'Vous avez quitté le groupe',
        groupId
      });
    } catch (error) {
      console.error('Erreur lors du départ du groupe:', error);
      socket.emit('error', { message: 'Erreur serveur lors du départ du groupe' });
    }
  });
  
  // Créer un nouveau groupe
  socket.on('create-group', async (groupData) => {
    const data = dataParse(groupData);
    try {
      const { 
        name, 
        description, 
        isPrivate = false, 
        price = 0, 
        coordinates=[0,0],
        address = '',
        venueName = '',
        visibility = 'public',
        creator 
      } = data;
      
      if (!name || !description || !creator || !coordinates) {
        return socket.emit('error', { message: 'Informations de groupe incomplètes' });
      }
      
      // Créer le nouveau groupe
      const newGroup = new Group({
        name,
        description,
        members: [creator],
        admins: [creator],
        isPrivate,
        price: price || 0,
        location: {
          type: 'Point',
          coordinates,
          address,
          venueName
        },
        visibility
      });
      
      const savedGroup = await newGroup.save();
      
      // Rejoindre la salle socket du groupe
      socket.join(`group:${savedGroup._id}`);
      
     /*  // Si le groupe est public et a une localisation, notifier les utilisateurs à proximité
      if (visibility === 'public' && coordinates) {
        // Notifier les utilisateurs dans un rayon de 1km
        const radius = 1000; // 1km
        await notifyNearbyUsers({
          coordinates,
          radius,
          notification: {
            type: 'group_nearby',
            title: 'Nouveau groupe à proximité',
            message: `Un nouveau groupe "${name}" a été créé près de vous`,
            relatedEntity: {
              entityType: 'Group',
              entityId: savedGroup._id
            },
            priority: 'normal'
          },
          excludeUserId: creator
        });
      } */
      
      socket.emit('group-created', { 
        success: true, 
        message: 'Groupe créé avec succès',
        group: savedGroup
      });
    } catch (error) {
      console.error('Erreur lors de la création du groupe:', error);
      socket.emit('group:error', { message: 'Erreur serveur lors de la création du groupe' });
    }
  });
  
  // Mettre à jour un groupe
  socket.on('update-group', async (data) => {
    try {
      const { 
        groupId, 
        userId,
        name, 
        description, 
        isPrivate, 
        price,
        coordinates,
        address,
        venueName,
        visibility,
        photo
      } = data;
      
      if (!groupId || !userId) {
        return socket.emit('error', { message: 'Informations de groupe incomplètes' });
      }
      
      // Vérifier si le groupe existe
      const group = await Group.findById(groupId);
      if (!group) {
        return socket.emit('error', { message: 'Groupe introuvable' });
      }
      
      // Vérifier si l'utilisateur est administrateur
      if (!group.admins.includes(userId)) {
        return socket.emit('error', { message: 'Vous n\'êtes pas administrateur de ce groupe' });
      }
      
      // Construire l'objet de mise à jour
      const updateObject = {};
      if (name) updateObject.name = name;
      if (description) updateObject.description = description;
      if (isPrivate !== undefined) updateObject.isPrivate = isPrivate;
      if (price !== undefined) updateObject.price = price;
      if (photo) updateObject.photo = photo;
      if (visibility) updateObject.visibility = visibility;
      
      // Mettre à jour la localisation si fournie
      if (coordinates) {
        updateObject.location = {
          type: 'Point',
          coordinates,
          ...(address && { address }),
          ...(venueName && { venueName })
        };
      }
      
      const updatedGroup = await Group.findByIdAndUpdate(
        groupId,
        updateObject,
        { new: true }
      );
      
      // Notifier tous les membres du groupe
      io.to(`group:${groupId}`).emit('group-updated', {
        group: updatedGroup
      });
      
      socket.emit('group-update-success', { 
        success: true, 
        message: 'Groupe mis à jour avec succès',
        group: updatedGroup
      });
    } catch (error) {
      console.error('Erreur lors de la mise à jour du groupe:', error);
      socket.emit('error', { message: 'Erreur serveur lors de la mise à jour du groupe' });
    }
  });
  
  // Ajouter un administrateur au groupe
  socket.on('add-group-admin', async (data) => {
    try {
      const { groupId, adminId, newAdminId } = data;
      
      if (!groupId || !adminId || !newAdminId) {
        return socket.emit('error', { message: 'Informations incomplètes' });
      }
      
      // Vérifier si le groupe existe
      const group = await Group.findById(groupId);
      if (!group) {
        return socket.emit('error', { message: 'Groupe introuvable' });
      }
      
      // Vérifier si l'utilisateur est administrateur
      if (!group.admins.includes(adminId)) {
        return socket.emit('error', { message: 'Vous n\'êtes pas administrateur de ce groupe' });
      }
      
      // Vérifier si le nouvel admin est membre du groupe
      if (!group.members.includes(newAdminId)) {
        return socket.emit('error', { message: 'L\'utilisateur n\'est pas membre du groupe' });
      }
      
      // Ajouter le nouvel administrateur
      const updatedGroup = await Group.findByIdAndUpdate(
        groupId,
        { $addToSet: { admins: newAdminId } },
        { new: true }
      );
      
      // Notifier tous les membres du groupe
      io.to(`group:${groupId}`).emit('admin-added', {
        groupId,
        adminId: newAdminId
      });
      
      socket.emit('admin-add-success', { 
        success: true, 
        message: 'Administrateur ajouté avec succès',
        group: updatedGroup
      });
    } catch (error) {
      console.error('Erreur lors de l\'ajout d\'un administrateur:', error);
      socket.emit('error', { message: 'Erreur serveur lors de l\'ajout d\'un administrateur' });
    }
  });
  
  // Rechercher des groupes à proximité
  socket.on('find-nearby-groups', async (data) => {
    try {
      const { coordinates, radius = 1000, userId } = data;
      
      if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
        return socket.emit('error', { message: 'Coordonnées invalides' });
      }
      
      // Construire la requête
      const query = {
        'location.coordinates': {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates
            },
            $maxDistance: radius
          }
        }
      };
      
      // Exclure les groupes privés si l'utilisateur n'est pas membre
      if (userId) {
        query.$or = [
          { isPrivate: false },
          { isPrivate: true, members: userId }
        ];
      } else {
        query.isPrivate = false;
      }
      
      const nearbyGroups = await Group.find(query)
        .select('name description photo location members averageRating')
        .populate('members', 'userPseudo profile.photo')
        .limit(20);
      
      socket.emit('nearby-groups', {
        groups: nearbyGroups,
        count: nearbyGroups.length,
        radius
      });
    } catch (error) {
      console.error('Erreur lors de la recherche de groupes à proximité:', error);
      socket.emit('error', { message: 'Erreur serveur lors de la recherche de groupes' });
    }
  });
  
  // Évaluer un groupe
  socket.on('rate-group', async (data) => {
    try {
      const { groupId, userId, rating, comment = '' } = data;
      
      if (!groupId || !userId || rating === undefined || rating < 1 || rating > 5) {
        return socket.emit('error', { message: 'Informations d\'évaluation invalides' });
      }
      
      // Vérifier si le groupe existe
      const group = await Group.findById(groupId);
      if (!group) {
        return socket.emit('error', { message: 'Groupe introuvable' });
      }
      
      // Vérifier si l'utilisateur est membre du groupe
      if (!group.members.includes(userId)) {
        return socket.emit('error', { message: 'Vous devez être membre du groupe pour l\'évaluer' });
      }
      
      // Vérifier si l'utilisateur a déjà évalué ce groupe
      const existingRatingIndex = group.ratings.findIndex(
        r => r.user && r.user.toString() === userId
      );
      
      if (existingRatingIndex !== -1) {
        // Mettre à jour l'évaluation existante
        group.ratings[existingRatingIndex].rating = rating;
        group.ratings[existingRatingIndex].comment = comment;
        group.ratings[existingRatingIndex].createdAt = new Date();
      } else {
        // Ajouter une nouvelle évaluation
        group.ratings.push({
          user: userId,
          rating,
          comment,
          createdAt: new Date()
        });
      }
      
      // Recalculer la note moyenne
      if (group.ratings.length > 0) {
        const totalRating = group.ratings.reduce((sum, r) => sum + r.rating, 0);
        group.averageRating = totalRating / group.ratings.length;
      }
      
      const updatedGroup = await group.save();
      
      // Notifier les administrateurs du groupe
      const user = await User.findById(userId).select('userPseudo');
      if (user) {
        for (const adminId of group.admins) {
          const notification = new Notification({
            recipient: adminId,
            sender: userId,
            type: 'system_notification',
            title: 'Nouvelle évaluation de groupe',
            message: `${user.userPseudo} a évalué le groupe "${group.name}" (${rating}/5)`,
            relatedEntity: {
              entityType: 'Group',
              entityId: groupId
            },
            priority: 'normal'
          });
          
          await notification.save();
          io.to(`user:${adminId}`).emit('new-notification', notification);
        }
      }
      
      socket.emit('rating-success', { 
        success: true, 
        message: 'Évaluation enregistrée avec succès',
        averageRating: updatedGroup.averageRating
      });
      
      // Informer les membres du groupe
      io.to(`group:${groupId}`).emit('group-rated', {
        groupId,
        averageRating: updatedGroup.averageRating,
        ratingsCount: updatedGroup.ratings.length
      });
    } catch (error) {
      console.error('Erreur lors de l\'évaluation du groupe:', error);
      socket.emit('error', { message: 'Erreur serveur lors de l\'évaluation du groupe' });
    }
  });
}