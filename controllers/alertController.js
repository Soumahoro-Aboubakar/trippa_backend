import Alert from '../models/Alert.js';
import { storeMedia } from '../services/mediaService.js';
import { findNearbyUsers } from '../services/geoService.js';
import { sendAlertNotification } from '../services/notificationService.js';

// Créer une nouvelle alerte
export const createAlert = async (alertData, io) => {
    try {
        const alert = new Alert(alertData);
        await alert.save();

        // Envoyer des notifications aux utilisateurs à proximité
        await sendAlertNotification(alert, io);

        return alert;
    } catch (error) {
        console.error('Erreur lors de la création de l\'alerte:', error);
        throw error;
    }
};

// Créer une alerte via API REST
export const createAlertAPI = async (req, res) => {
    try {
        const { type, description, coordinates, radius } = req.body;

        let mediaUrl = null;
        if (req.file) {
            const media = await storeMedia(req.file, 'alerts');
            mediaUrl = media.url;
        }

        const alert = new Alert({
            creator: req.user.id,
            type,
            description,
            location: {
                type: 'Point',
                coordinates
            },
            radius: radius || 1000,
            mediaUrl
        });

        await alert.save();

        // Envoyer des notifications (via socket.io global)
        const io = req.app.get('io');
        await sendAlertNotification(alert, io);

        res.status(201).json(alert);
    } catch (error) {
        console.error('Erreur lors de la création de l\'alerte:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};

// Obtenir les alertes à proximité
export const getNearbyAlerts = async (req, res) => {
    try {
        const { radius = 2000 } = req.query;

        // Obtenir la position de l'utilisateur actuel
        const currentUser = await User.findById(req.user.id);
        if (!currentUser.location || !currentUser.location.coordinates) {
            return res.status(400).json({ message: 'Position de l\'utilisateur non disponible' });
        }

        // Trouver les alertes actives à proximité
        const alerts = await Alert.find({
            isActive: true,
            expireAt: { $gt: new Date() },
            'location.coordinates': {
                $near: {
                    $geometry: {
                        type: 'Point',
                        coordinates: currentUser.location.coordinates
                    },
                    $maxDistance: Number(radius)
                }
            }
        }).populate('creator', 'userPseudo profile.photo');

        res.json(alerts);
    } catch (error) {
        console.error('Erreur lors de la récupération des alertes à proximité:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};

// Confirmer une alerte
export const confirmAlert = async (req, res) => {
    try {
        const alert = await Alert.findById(req.params.alertId);

        if (!alert) {
            return res.status(404).json({ message: 'Alerte non trouvée' });
        }

        // Vérifier si l'utilisateur a déjà confirmé l'alerte
        if (alert.confirmations.some(conf => conf.user.toString() === req.user.id)) {
            return res.status(400).json({ message: 'Alerte déjà confirmée par cet utilisateur' });
        }

        // Ajouter la confirmation
        alert.confirmations.push({
            user: req.user.id,
            createdAt: new Date()
        });

        await alert.save();

        res.json(alert);
    } catch (error) {
        console.error('Erreur lors de la confirmation de l\'alerte:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};