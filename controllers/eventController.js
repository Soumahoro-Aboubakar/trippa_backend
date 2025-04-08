import Event from '../models/Event.js';
import User from '../models/User.js';
import mediaService from '../services/mediaService.js';
import notificationService from '../services/notificationService.js';

const eventController = {
    // Créer un nouvel événement
    createEvent: async (req, res) => {
        try {
            const {
                title,
                description,
                accessType,
                price,
                eventType,
                coordinates,
                address,
                venueName,
                visibilityRadius,
                startDate,
                endDate,
                repeat,
                maxParticipants,
                isPublic,
                categories,
                tags,
                dangerLevel
            } = req.body;

            // Vérifier les champs obligatoires
            if (!title || !description || !eventType || !coordinates || !startDate || !endDate) {
                return res.status(400).json({ message: 'Veuillez fournir toutes les informations requises' });
            }

            // Vérifier que la date de fin est après la date de début
            if (new Date(endDate) <= new Date(startDate)) {
                return res.status(400).json({ message: 'La date de fin doit être après la date de début' });
            }

            // Gérer les médias si présents
            let media = [];
            if (req.files && req.files.length > 0) {
                for (const file of req.files) {
                    const mediaType = file.mimetype.startsWith('image/') ? 'image' :
                        file.mimetype.startsWith('video/') ? 'video' : 'document';

                    const url = await mediaService.uploadMedia(file, 'event_media'); //A revoir utilise backblaze.js

                    media.push({
                        type: mediaType,
                        url,
                        caption: file.originalname
                    });
                }
            }

            // Créer le nouvel événement
            const newEvent = new Event({
                creator: req.user._id,
                title,
                description,
                accessType: accessType || 'public',
                price: accessType === 'paid' ? price : 0,
                eventType,
                location: {
                    type: 'Point',
                    coordinates,
                    address,
                    venueName
                },
                visibilityRadius: visibilityRadius || 1000,
                startDate,
                endDate,
                repeat: repeat || 'none',
                maxParticipants,
                isPublic: isPublic !== undefined ? isPublic : true,
                isPaid: accessType === 'paid',
                categories: categories || [],
                tags: tags || [],
                media,
                status: 'scheduled',
                dangerLevel: dangerLevel || 0
            });

            await newEvent.save();

            // Notifier les utilisateurs à proximité
            if (isPublic) {
                const nearbyUsers = await User.find({
                    'location.coordinates': {
                        $near: {
                            $geometry: {
                                type: 'Point',
                                coordinates
                            },
                            $maxDistance: visibilityRadius || 1000
                        }
                    },
                    _id: { $ne: req.user._id } // Exclure le créateur
                });

                // Envoyer les notifications
                for (const user of nearbyUsers) {
                    await notificationService.createNotification({
                        recipient: user._id,
                        sender: req.user._id,
                        type: 'event_nearby',
                        title: 'Nouvel événement à proximité',
                        message: `"${title}" se déroule près de vous`,
                        relatedEntity: {
                            entityType: 'Event',
                            entityId: newEvent._id
                        },
                        priority: dangerLevel >= 2 ? 'high' : 'normal',
                        isActionRequired: false
                    });
                }
            }

            res.status(201).json(newEvent);
        } catch (error) {
            console.error('Erreur lors de la création de l\'événement:', error);
            res.status(500).json({ message: 'Erreur lors de la création de l\'événement', error: error.message });
        }
    },

    // Récupérer les événements à proximité
    getNearbyEvents: async (req, res) => {
        try {
            const { longitude, latitude, radius = 5000, eventType, startDate, endDate } = req.query;

            if (!longitude || !latitude) {
                return res.status(400).json({ message: 'Coordonnées géographiques requises' });
            }

            const coordinates = [parseFloat(longitude), parseFloat(latitude)];

            // Construire la requête de base
            const query = {
                status: { $in: ['scheduled', 'active'] },
                'location.coordinates': {
                    $near: {
                        $geometry: {
                            type: 'Point',
                            coordinates
                        },
                        $maxDistance: parseInt(radius)
                    }
                }
            };

            // Filtrer par type d'événement si spécifié
            if (eventType) {
                query.eventType = eventType;
            }

            // Filtrer par date si spécifié
            if (startDate || endDate) {
                query.startDate = {};
                if (startDate) {
                    query.startDate.$gte = new Date(startDate);
                }
                if (endDate) {
                    query.endDate = { $lte: new Date(endDate) };
                }
            } else {
                // Par défaut, afficher les événements futurs
                query.endDate = { $gte: new Date() };
            }

            // Récupérer les événements
            const events = await Event.find(query)
                .populate('creator', 'userPseudo profile.photo')
                .sort({ startDate: 1 });

            res.status(200).json(events);
        } catch (error) {
            console.error('Erreur lors de la récupération des événements:', error);
            res.status(500).json({ message: 'Erreur lors de la récupération des événements', error: error.message });
        }
    },

    // Récupérer un événement par son ID
    getEventById: async (req, res) => {
        try {
            const event = await Event.findById(req.params.id)
                .populate('creator', 'userPseudo profile.photo')
                .populate('participants.user', 'userPseudo profile.photo');

            if (!event) {
                return res.status(404).json({ message: 'Événement non trouvé' });
            }

            // Vérifier si l'événement est privé
            if (event.accessType === 'private' &&
                event.creator.toString() !== req.user._id.toString() &&
                !event.participants.some(p => p.user._id.toString() === req.user._id.toString())) {
                return res.status(403).json({ message: 'Cet événement est privé' });
            }

            res.status(200).json(event);
        } catch (error) {
            console.error('Erreur lors de la récupération de l\'événement:', error);
            res.status(500).json({ message: 'Erreur lors de la récupération de l\'événement', error: error.message });
        }
    },

    // Mettre à jour un événement
    updateEvent: async (req, res) => {
        try {
            const { id } = req.params;
            const updates = req.body;

            // Vérifier si l'événement existe et appartient à l'utilisateur
            const event = await Event.findById(id);

            if (!event) {
                return res.status(404).json({ message: 'Événement non trouvé' });
            }

            if (event.creator.toString() !== req.user._id.toString()) {
                return res.status(403).json({ message: 'Vous n\'êtes pas autorisé à modifier cet événement' });
            }

            // Gérer l'upload de nouveaux médias si présents
            if (req.files && req.files.length > 0) {
                const newMedia = [];
                for (const file of req.files) {
                    const mediaType = file.mimetype.startsWith('image/') ? 'image' :  //A revoir
                        file.mimetype.startsWith('video/') ? 'video' : 'document'; //A revoir

                    const url = await mediaService.uploadMedia(file, 'event_media');

                    newMedia.push({
                        type: mediaType,
                        url,
                        caption: file.originalname
                    });
                }

                // Ajouter aux médias existants
                if (!updates.media) {
                    updates.media = event.media || [];
                }
                updates.media = [...updates.media, ...newMedia];  //A revoir car l'utilisateur peux supprimer les anciens médias
            }

            // Mettre à jour les coordonnées si fournies
            if (updates.coordinates) {
                updates.location = {
                    type: 'Point',
                    coordinates: updates.coordinates,
                    address: updates.address || event.location.address,
                    venueName: updates.venueName || event.location.venueName
                };
                delete updates.coordinates;
                delete updates.address;
                delete updates.venueName;
            }

            const updatedEvent = await Event.findByIdAndUpdate(
                id,
                { $set: updates },
                { new: true, runValidators: true }
            );

            res.status(200).json(updatedEvent);
        } catch (error) {
            console.error('Erreur lors de la mise à jour de l\'événement:', error);
            res.status(500).json({ message: 'Erreur lors de la mise à jour de l\'événement', error: error.message });
        }
    },

    // Supprimer un événement
    deleteEvent: async (req, res) => {
        try {
            const { id } = req.params;

            // Vérifier si l'événement existe et appartient à l'utilisateur
            const event = await Event.findById(id);

            if (!event) {
                return res.status(404).json({ message: 'Événement non trouvé' });
            }

            if (event.creator.toString() !== req.user._id.toString()) {
                return res.status(403).json({ message: 'Vous n\'êtes pas autorisé à supprimer cet événement' });
            }

            // Supprimer les médias associés de Backblaze si nécessaire
            if (event.media && event.media.length > 0) {
                const deletePromises = event.media.map(media =>
                    mediaService.deleteMedia(media.url)
                );
                await Promise.all(deletePromises);
            }

            // Notifier les participants de l'annulation
            if (event.participants && event.participants.length > 0) {
                for (const participant of event.participants) {
                    await notificationService.createNotification({
                        recipient: participant.user,
                        sender: req.user._id,
                        type: 'event_cancelled',
                        title: 'Événement annulé',
                        message: `L'événement "${event.title}" a été annulé`,
                        relatedEntity: {
                            entityType: 'Event',
                            entityId: event._id
                        },
                        priority: 'normal'
                    });
                }
            }

            await Event.findByIdAndDelete(id);
            res.status(200).json({ message: 'Événement supprimé avec succès' });
        } catch (error) {
            console.error('Erreur lors de la suppression de l\'événement:', error);
            res.status(500).json({ message: 'Erreur lors de la suppression de l\'événement', error: error.message });
        }
    },

    // Participer ou mettre à jour le statut de participation
    updateParticipation: async (req, res) => {
        try {
            const { eventId } = req.params;
            const { status } = req.body;
            const userId = req.user._id;

            if (!['going', 'maybe', 'declined'].includes(status)) { //A revoir
                return res.status(400).json({ message: 'Statut de participation invalide' });
            }

            const event = await Event.findById(eventId);

            if (!event) {
                return res.status(404).json({ message: 'Événement non trouvé' });
            }

            // Vérifier si l'événement est complet
            if (status === 'going' &&
                event.maxParticipants &&
                event.participants.filter(p => p.status === 'going').length >= event.maxParticipants) {
                return res.status(400).json({ message: 'Cet événement est complet' });
            }

            // Vérifier si l'utilisateur existe déjà dans les participants
            const participantIndex = event.participants.findIndex(
                p => p.user.toString() === userId.toString()
            );

            if (participantIndex !== -1) {
                // Mettre à jour le statut existant
                event.participants[participantIndex].status = status;
                event.participants[participantIndex].joinedAt = new Date();
            } else {
                // Ajouter un nouveau participant
                event.participants.push({
                    user: userId,
                    status,
                    joinedAt: new Date()
                });
            }

            await event.save();

            // Notifier le créateur de l'événement
            if (status === 'going' && event.creator.toString() !== userId.toString()) {
                await notificationService.createNotification({
                    recipient: event.creator,
                    sender: userId,
                    type: 'event_participation',
                    title: 'Nouveau participant',
                    message: `${req.user.userPseudo} participera à votre événement "${event.title}"`,
                    relatedEntity: {
                        entityType: 'Event',
                        entityId: event._id
                    },
                    priority: 'normal'
                });
            }

            res.status(200).json({
                message: 'Participation mise à jour avec succès',
                status
            });
        } catch (error) {
            console.error('Erreur lors de la mise à jour de la participation:', error);
            res.status(500).json({
                message: 'Erreur lors de la mise à jour de la participation',
                error: error.message
            });
        }
    }
};

export default eventController;