import express from 'express';
import http from 'http';
import { Server as SocketIO } from 'socket.io';
import mongoose from 'mongoose';
//import { setupUserSocketHandlers } from './chemin/vers/votreFichier.js'; // Importez la fonction setupUserSocketHandlers
import dotenv from 'dotenv';
import userHandlers from './socket/userHandlers.js';
import { setupSocketHandlers } from './services/socketService.js';
import { initializeAuthenticatedUser, setupErrorHandlers, socketMessageHandlers } from './socket/messageHandlers.js';
import groupHandlers from './socket/groupHandlers.js';
import { setupRoomSocket } from './socket/roomHandlers.js';
import { setupPaymentSocket } from './controllers/paymentController.js';
import User from './models/user.model.js';
import Message from './models/message.model.js';
import Notification from './models/notification.model.js';
import jwt from 'jsonwebtoken';
import { generateRefreshToken, generateToken } from './controllers/userController.js';
import { refreshUserToken, verifyToken } from './services/authService.js';
import { dataParse } from './utils/validator.js';

dotenv.config();
// Configuration d'Express
const app = express();
const server = http.createServer(app);
const authEvenNames = ["verification:code","create_user","resent:verification_code"]
  
  // Configuration de Socket.IO
const io = new SocketIO(server, {
    pingTimeout: 60000, // 60s sans activité avant déconnexion
    pingInterval: 25000, // Envoi de ping toutes les 25s
    maxHttpBufferSize: 1e8, // Taille max des messages (100MB)
    reconnectionAttempts: 5, // Nombre de tentatives de reconnexion
    reconnectionDelay: 1000, //Delai de reconnexion
    transports: ['websocket'], // Force WebSocket uniquement
    cors: {
        origin: process.env.CORS_ORIGIN,
        methods: ["GET", "POST"]
    }
});

// Connexion à MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('Connecté à MongoDB'))
    .catch(err => console.error('Erreur de connexion MongoDB:', err));

// Configuration des routes Express (si besoin)
app.use(express.json());
global.connectedUsers = new Map()
// Middleware d'authentification Socket.IO
io.use((socket, next) => {
    const token = socket.handshake.query.token ;
    if (!token) {
        socket.userData = { isNew: true };
        return next();
    }

    verifyToken(token)
        .then(decoded => {
            socket.userData = { _id: decoded.userId };
            next();
        })
        .catch(error => {
            if (error.name === 'TokenExpiredError') {
                socket.emit("expired:token", { message: "Token expiré" });
            }
            socket.userData = { isNew: true };
            next();
        });
});
// Initialisation des gestionnaires de sockets
io.on('connection', async (socket) => {

    // Gestion du rafraîchissement de token
    socket.on("update:refresh_token", async (data) => {
        try {
            const result = await refreshUserToken({
                ...dataParse(data),
                userId: socket.userData._id
            });
            if (result.error) {
                socket.emit("refresh_error", result.error);
            } else {
                socket.emit("token_refreshed", result.tokens);
            }
        } catch (error) {
            socket.emit("refresh_error", { code: 500, message: "Erreur serveur" });
        }
    });

    // Initialisation utilisateur authentifié
    if (socket.userData && socket.userData._id && !socket.userData.isNew) {
        try {
            await initializeAuthenticatedUser(socket, socket.userData._id);
        } catch (error) {
            console.error('Erreur d\'initialisation utilisateur:', error);
            return socket.disconnect();
        }
    } else {
        // Utilisateur non authentifié, limiter les événements disponibles
        socket.onAny((eventName, ...args) => {     
            if (eventName && !authEvenNames.includes(eventName.trim())) return socket.disconnect();
        });
    }

    console.log(`Utilisateur connecté: ${socket.userData._id}`);
    console.log(`Nombre d'utilisateurs connectés: ${global.connectedUsers.size}`);
    userHandlers(io, socket);
    setupSocketHandlers(io);//une fonction permet de gérer les utilitaires des  utilisateurs
    socketMessageHandlers(io, socket); //on doit utiliser variable globale connectedUsers pour gérer les utilisateurs connectés
    // groupHandlers(io, socket);
    setupPaymentSocket(socket); //on doit utiliser variable globale connectedUsers pour gérer les utilisateurs connectés
    setupRoomSocket(io, socket); //on doit utiliser variable globale connectedUsers pour gérer les utilisateurs connectés
    setupErrorHandlers(socket);
})



// Démarrage du serveur
server.listen(process.env.PORT, () => {
    console.log(`Serveur démarré sur le port ${process.env.PORT}`);
});