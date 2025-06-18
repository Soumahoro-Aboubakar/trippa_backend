// app.js - API Express pour la messagerie sécurisée
const express = require('express');
const cors = require('cors');
const MessageService = require('./message-service');

const app = express();
const messageService = new MessageService();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Middleware de validation
const validateUser = (req, res, next) => {
    const { userId } = req.body;
    if (!userId) {
        return res.status(400).json({ success: false, error: 'userId requis' });
    }
    next();
};

/**
 * Enregistrement d'un nouvel utilisateur
 */
app.post('/api/users/register', async (req, res) => {
    try {
        const { userId, publicKey, deviceId } = req.body;

        if (!userId || !publicKey || !deviceId) {
            return res.status(400).json({
                success: false,
                error: 'userId, publicKey et deviceId sont requis'
            });
        }

        const result = await messageService.registerUser(userId, publicKey, deviceId);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Erreur lors de l\'enregistrement'
        });
    }
});

/**
 * Mise à jour de la clé publique (changement d'appareil)
 */
app.post('/api/users/update-key', validateUser, async (req, res) => {
    try {
        const { userId, newPublicKey, newDeviceId } = req.body;

        if (!newPublicKey || !newDeviceId) {
            return res.status(400).json({
                success: false,
                error: 'newPublicKey et newDeviceId sont requis'
            });
        }

        const result = await messageService.updateUserKey(userId, newPublicKey, newDeviceId);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la mise à jour de la clé'
        });
    }
});

/**
 * Envoi d'un message
 */
app.post('/api/messages/send', async (req, res) => {
    try {
        const { senderId, recipientId, message } = req.body;

        if (!senderId || !recipientId || !message) {
            return res.status(400).json({
                success: false,
                error: 'senderId, recipientId et message sont requis'
            });
        }

        const result = await messageService.sendMessage(senderId, recipientId, message);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Erreur lors de l\'envoi du message'
        });
    }
});

/**
 * Récupération des messages
 */
app.post('/api/messages/get', validateUser, async (req, res) => {
    try {
        const { userId, privateKey } = req.body;

        if (!privateKey) {
            return res.status(400).json({
                success: false,
                error: 'privateKey est requis'
            });
        }

        const result = await messageService.getMessages(userId, privateKey);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la récupération des messages'
        });
    }
});

/**
 * Création d'une sauvegarde
 */
app.post('/api/backup/create', validateUser, async (req, res) => {
    try {
        const { userId, privateKey, password } = req.body;

        if (!privateKey || !password) {
            return res.status(400).json({
                success: false,
                error: 'privateKey et password sont requis'
            });
        }

        const result = await messageService.createChatBackup(userId, privateKey, password);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la création de la sauvegarde'
        });
    }
});

/**
 * Restauration d'une sauvegarde
 */
app.post('/api/backup/restore', async (req, res) => {
    try {
        const { backupId, password } = req.body;

        if (!backupId || !password) {
            return res.status(400).json({
                success: false,
                error: 'backupId et password sont requis'
            });
        }

        const result = await messageService.restoreChatBackup(backupId, password);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la restauration'
        });
    }
});

/**
 * Informations utilisateur
 */
app.get('/api/users/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const result = messageService.getUserInfo(userId);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la récupération des informations utilisateur'
        });
    }
});

/**
 * Liste des utilisateurs
 */
app.get('/api/users', async (req, res) => {
    try {
        const users = messageService.listUsers();
        res.json({ success: true, users });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la récupération de la liste des utilisateurs'
        });
    }
});

/**
 * Vérification de l'intégrité d'une clé
 */
app.post('/api/keys/verify', async (req, res) => {
    try {
        const { publicKey, expectedFingerprint } = req.body;

        if (!publicKey || !expectedFingerprint) {
            return res.status(400).json({
                success: false,
                error: 'publicKey et expectedFingerprint sont requis'
            });
        }

        const result = messageService.verifyKeyIntegrity(publicKey, expectedFingerprint);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la vérification de la clé'
        });
    }
});

/**
 * Clé publique du serveur
 */
app.get('/api/server/public-key', async (req, res) => {
    try {
        const publicKey = messageService.cryptoService.getServerPublicKey();
        res.json({ success: true, publicKey });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la récupération de la clé publique du serveur'
        });
    }
});

// Middleware de gestion d'erreurs
app.use((error, req, res, next) => {
    console.error('Erreur:', error);
    res.status(500).json({
        success: false,
        error: 'Erreur interne du serveur'
    });
});

// Démarrage du serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Serveur de messagerie sécurisée démarré sur le port ${PORT}`);
    console.log(`📍 API disponible sur http://localhost:${PORT}/api`);
});

module.exports = app;