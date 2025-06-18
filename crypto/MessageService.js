// message-service.js - Service de gestion des messages
const CryptoService = require('./crypto-service');
const { v4: uuidv4 } = require('uuid');

class MessageService {
    constructor() {
        this.cryptoService = new CryptoService();
        this.users = new Map(); // Simulation d'une base de données
        this.messages = new Map();
        this.backups = new Map();
    }

    /**
     * Enregistre un nouvel utilisateur avec ses clés
     */
    async registerUser(userId, publicKey, deviceId) {
        const fingerprint = this.cryptoService.generateKeyFingerprint(publicKey);
        
        const user = {
            userId,
            publicKey,
            deviceId,
            fingerprint,
            createdAt: new Date().toISOString(),
            lastKeyUpdate: new Date().toISOString()
        };

        this.users.set(userId, user);
        
        return {
            success: true,
            fingerprint,
            serverPublicKey: this.cryptoService.getServerPublicKey()
        };
    }

    /**
     * Met à jour la clé publique d'un utilisateur (changement d'appareil)
     */
    async updateUserKey(userId, newPublicKey, newDeviceId) {
        const user = this.users.get(userId);
        if (!user) {
            return { success: false, error: 'Utilisateur non trouvé' };
        }

        const oldFingerprint = user.fingerprint;
        const newFingerprint = this.cryptoService.generateKeyFingerprint(newPublicKey);

        // Mise à jour des informations utilisateur
        user.publicKey = newPublicKey;
        user.deviceId = newDeviceId;
        user.fingerprint = newFingerprint;
        user.lastKeyUpdate = new Date().toISOString();

        this.users.set(userId, user);

        // Notifier les contacts du changement de clé
        const notification = await this.createKeyChangeNotification(userId, oldFingerprint, newFingerprint);

        return {
            success: true,
            newFingerprint,
            keyChangeNotification: notification
        };
    }

    /**
     * Crée une notification de changement de clé
     */
    async createKeyChangeNotification(userId, oldFingerprint, newFingerprint) {
        return {
            type: 'KEY_CHANGE',
            userId,
            message: 'Le code de sécurité de ce contact a changé.',
            oldFingerprint,
            newFingerprint,
            timestamp: new Date().toISOString(),
            requiresVerification: true
        };
    }

    /**
     * Envoie un message chiffré
     */
    async sendMessage(senderId, recipientId, messageContent) {
        const sender = this.users.get(senderId);
        const recipient = this.users.get(recipientId);

        if (!sender || !recipient) {
            return { success: false, error: 'Utilisateur non trouvé' };
        }

        // Chiffrement hybride du message
        const encryptedData = this.cryptoService.hybridEncrypt(
            messageContent, 
            recipient.publicKey
        );

        const message = {
            id: uuidv4(),
            senderId,
            recipientId,
            encryptedMessage: encryptedData.encryptedMessage,
            encryptedAESKey: encryptedData.encryptedAESKey,
            iv: encryptedData.iv,
            timestamp: encryptedData.timestamp,
            senderFingerprint: sender.fingerprint
        };

        this.messages.set(message.id, message);

        return {
            success: true,
            messageId: message.id,
            timestamp: message.timestamp
        };
    }

    /**
     * Récupère et déchiffre les messages d'un utilisateur
     */
    async getMessages(userId, privateKey) {
        const userMessages = Array.from(this.messages.values()).filter(
            msg => msg.recipientId === userId || msg.senderId === userId
        );

        const decryptedMessages = [];

        for (const message of userMessages) {
            if (message.recipientId === userId) {
                // Déchiffrer le message reçu
                const decryptedData = this.cryptoService.hybridDecrypt({
                    encryptedMessage: message.encryptedMessage,
                    encryptedAESKey: message.encryptedAESKey,
                    iv: message.iv,
                    timestamp: message.timestamp
                }, privateKey);

                if (decryptedData.success) {
                    decryptedMessages.push({
                        id: message.id,
                        senderId: message.senderId,
                        recipientId: message.recipientId,
                        content: decryptedData.message,
                        timestamp: message.timestamp,
                        senderFingerprint: message.senderFingerprint,
                        type: 'received'
                    });
                } else {
                    // Message non déchiffrable (probablement dû à un changement de clé)
                    decryptedMessages.push({
                        id: message.id,
                        senderId: message.senderId,
                        recipientId: message.recipientId,
                        content: '[Message non déchiffrable - Clé de sécurité modifiée]',
                        timestamp: message.timestamp,
                        type: 'error'
                    });
                }
            } else {
                // Message envoyé (pas besoin de déchiffrement pour l'affichage)
                decryptedMessages.push({
                    id: message.id,
                    senderId: message.senderId,
                    recipientId: message.recipientId,
                    content: '[Message envoyé]',
                    timestamp: message.timestamp,
                    type: 'sent'
                });
            }
        }

        return {
            success: true,
            messages: decryptedMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
        };
    }

    /**
     * Crée une sauvegarde de l'historique de chat
     */
    async createChatBackup(userId, privateKey, password) {
        const user = this.users.get(userId);
        if (!user) {
            return { success: false, error: 'Utilisateur non trouvé' };
        }

        // Récupérer tous les messages de l'utilisateur
        const messagesResult = await this.getMessages(userId, privateKey);
        if (!messagesResult.success) {
            return { success: false, error: 'Impossible de récupérer les messages' };
        }

        // Créer la sauvegarde chiffrée
        const backup = await this.cryptoService.createBackup(
            messagesResult.messages, 
            password
        );

        const backupId = uuidv4();
        this.backups.set(backupId, {
            ...backup,
            userId,
            backupId
        });

        return {
            success: true,
            backupId,
            message: 'Sauvegarde créée avec succès'
        };
    }

    /**
     * Restaure une sauvegarde de chat
     */
    async restoreChatBackup(backupId, password) {
        const backup = this.backups.get(backupId);
        if (!backup) {
            return { success: false, error: 'Sauvegarde non trouvée' };
        }

        const restoredData = await this.cryptoService.restoreBackup(backup, password);
        
        return restoredData;
    }

    /**
     * Obtient les informations d'un utilisateur
     */
    getUserInfo(userId) {
        const user = this.users.get(userId);
        if (!user) {
            return { success: false, error: 'Utilisateur non trouvé' };
        }

        return {
            success: true,
            user: {
                userId: user.userId,
                fingerprint: user.fingerprint,
                lastKeyUpdate: user.lastKeyUpdate,
                deviceId: user.deviceId
            }
        };
    }

    /**
     * Liste les utilisateurs disponibles
     */
    listUsers() {
        return Array.from(this.users.values()).map(user => ({
            userId: user.userId,
            fingerprint: user.fingerprint,
            lastKeyUpdate: user.lastKeyUpdate
        }));
    }

    /**
     * Vérifie l'intégrité d'une clé publique
     */
    verifyKeyIntegrity(publicKey, expectedFingerprint) {
        const actualFingerprint = this.cryptoService.generateKeyFingerprint(publicKey);
        return {
            valid: actualFingerprint === expectedFingerprint,
            actualFingerprint,
            expectedFingerprint
        };
    }
}

module.exports = MessageService;