// controllers/groupController.js
import Group from '../models/Group.js';
import User from '../models/User.js';
import { storeMedia } from '../services/mediaService.js';
import { findNearbyEntities } from '../services/geoService.js';

// Créer un nouveau groupe
export const createGroup = async (req, res) => {
    try {
        const { name, description, isPrivate, coordinates, address, venueName , isPaid = false } = req.body;

        let photoUrl = null;
        if (req.file) {
            const media = await storeMedia(req.file, 'groups'); //A revoir
            photoUrl = media.url;
        }

        const group = new Group({
            name,
            description,
            members: [req.user.id],
            admins: [req.user.id],
            isPrivate: isPrivate === 'true', //on accède au groupe privée par lien ou code d'invitation
            location: {
                type: 'Point',
                coordinates,
                address,
                venueName
            },
            isPaid,
            photo: photoUrl,
            visibility: req.body.visibility || 'public'
        });

        await group.save();

        res.status(201).json(group);
    } catch (error) {
        console.error('Erreur lors de la création du groupe:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};

// Obtenir les groupes à proximité
export const getNearbyGroups = async (req, res) => {
    try {
        const { radius = 1000 } = req.query;

        // Obtenir la position de l'utilisateur actuel
        const currentUser = await User.findById(req.user.id);
        if (!currentUser.location || !currentUser.location.coordinates) {
            return res.status(400).json({ message: 'Position de l\'utilisateur non disponible' });
        }

        // Trouver les groupes à proximité
        const nearbyGroups = await findNearbyEntities(
            currentUser.location.coordinates,
            Number(radius),
            'Group',
            { visibility: 'public' }
        );

        res.json(nearbyGroups);
    } catch (error) {
        console.error('Erreur lors de la récupération des groupes à proximité:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};

// Rejoindre un groupe
export const joinGroup = async (req, res) => {
    try {
        const group = await Group.findById(req.params.groupId);

        if (!group) {
            return res.status(404).json({ message: 'Groupe non trouvé' });
        }

        // Vérifier si l'utilisateur est déjà membre
        if (group.members.includes(req.user.id)) {
            return res.status(400).json({ message: 'Vous êtes déjà membre de ce groupe' });
        }

        // Si le groupe est privé, vérifier si un administrateur a invité l'utilisateur
        if (group.isPrivate) {
            // Implémenter la logique d'invitation si nécessaire
            return res.status(403).json({ message: 'Ce groupe est privé. Une invitation est requise.' });
        }

        // Ajouter l'utilisateur aux membres
        group.members.push(req.user.id);
        await group.save();

        // Notifier via Socket.io
        const io = req.app.get('io'); //A revoir
        if (io) {
            const user = await User.findById(req.user.id).select('userPseudo profile.photo');
            io.to(`group:${group._id}`).emit('group:memberJoined', {
                groupId: group._id,
                user: {
                    id: user._id,
                    userPseudo: user.userPseudo,
                    photo: user.profile?.photo
                }
            });

            // Faire rejoindre l'utilisateur au canal du groupe s'il est connecté
            const socketId = getUserSocketId(req.user.id); //A revoir
            if (socketId) {
                const socket = io.sockets.sockets.get(socketId);
                if (socket) {
                    socket.join(`group:${group._id}`);
                }
            }
        }

        res.json({ message: 'Vous avez rejoint le groupe avec succès', group });
    } catch (error) {
        console.error('Erreur lors de la jointure au groupe:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};

// Évaluer un groupe
export const rateGroup = async (req, res) => {
    try {
        const { rating, comment } = req.body;

        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({ message: 'Note invalide (1-5)' });
        }

        const group = await Group.findById(req.params.groupId);

        if (!group) {
            return res.status(404).json({ message: 'Groupe non trouvé' });
        }

        // Vérifier si l'utilisateur est membre du groupe
        if (!group.members.includes(req.user.id)) {
            return res.status(403).json({ message: 'Vous devez être membre du groupe pour l\'évaluer' });
        }

        // Vérifier si l'utilisateur a déjà évalué le groupe
        const existingRatingIndex = group.ratings.findIndex(
            r => r.user.toString() === req.user.id
        );

        if (existingRatingIndex !== -1) {
            // Mettre à jour l'évaluation existante
            group.ratings[existingRatingIndex].rating = rating;
            group.ratings[existingRatingIndex].comment = comment;
            group.ratings[existingRatingIndex].createdAt = new Date();
        } else {
            // Ajouter une nouvelle évaluation
            group.ratings.push({
                user: req.user.id,
                rating,
                comment,
                createdAt: new Date()
            });
        }
    } catch (error) {
        console.error('Erreur lors de l\'évaluation du groupe:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
}