import express from "express";
import http from "http";
import { Server as SocketIO } from "socket.io";
import mongoose from "mongoose";
//import { setupUserSocketHandlers } from './chemin/vers/votreFichier.js'; // Importez la fonction setupUserSocketHandlers
import dotenv from "dotenv";
import userHandlers from "./socket/userHandlers.js";
import { setupSocketHandlers } from "./services/socketService.js";
import {
  initializeAuthenticatedUser,
  sendReceivedMessages,
  setupErrorHandlers,
  socketMessageHandlers,
} from "./socket/messageHandlers.js";
import { setupRoomSocket } from "./socket/roomHandlers.js";
import { setupPaymentSocket } from "./controllers/paymentController.js";
import { refreshUserToken, verifyToken } from "./services/authService.js";
import { dataParse } from "./utils/validator.js";
import  { mediaUploader } from "./config/fileUploader.js";
import { configureBusinessSocket } from "./socket/businessHandlers.js";
import { configureStatusSocket } from "./socket/statusHandlers.js";
import { markExpiredFileShares } from "./services/fileShareService.js";
import { setupFileShareSocket } from "./socket/fileShareHandlers.js";
import https from "https";
import { joinUserRooms } from "./controllers/userController.js";
import {  sendUnreadNotifications } from "./services/notificationService.js";


dotenv.config();
// Configuration d'Express
const app = express();
const server = http.createServer(app);
const authEventNames = [
  "verification:code",
  "create_user",
  "resent:verification_code",
  "update:refresh_token",
];

// Configuration de Socket.IO
const io = new SocketIO(server, {
  pingTimeout: 60000, // 60s sans activité avant déconnexion
  pingInterval: 25000, // Envoi de ping toutes les 25s
  maxHttpBufferSize: 10e6, // Taille max des messages (100MB)
  reconnectionAttempts: 5, // Nombre de tentatives de reconnexion
  reconnectionDelay: 1000, //Delai de reconnexion
  transports: ["websocket"], // Force WebSocket uniquement
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});



//global.uploadService = new UploadService(io);

// Connexion à MongoDB
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("Connecté à MongoDB"))
  .catch((err) => console.error("Erreur de connexion MongoDB:", err));

// Configuration des routes Express (si besoin)
app.use(express.json());

// Route basique
app.get('/ping', (req, res) => {
  res.send('Server is alive!'); //après un certain temps, render met le serveur en veille. cette route permet de garder le serveur en vie
});
// Fonction de self-ping toutes les 60 secondes

function autoPing() {
  setInterval(() => {
    https.get(process.env.SELF_URL, (res) => {
      console.log(`Pinged self: ${res.statusCode}`);
    }).on('error', (err) => {
      console.error(`Ping error: ${err.message}`);
    });
  }, 60 * 5000); //5 minutes
}

global.connectedUsers = new Map();

// Middleware d'authentification Socket.IO
io.use((socket, next) => {
  const token = socket.handshake.query.token;
  console.log("Token reçu:", token ? "présent" : "absent");
  
  if (!token || token === "null") {
    socket.userData = { isNew: true };
    return next();
  }
  
  verifyToken(token)
    .then((decoded) => {
      socket.userData = { _id: decoded.userId };
      console.log("Token décodé avec succès pour l'utilisateur:", decoded.userId);
      next();
    })
    .catch((error) => {
      console.log("Erreur de vérification du token:", error.name);
      
      // Pour les tokens expirés, permettre la connexion mais marquer comme nécessitant un refresh
      if (error.name === "TokenExpiredError") {
        socket.userData = { isNew: true, needsRefresh: true };
        console.log("Token expiré - connexion autorisée pour rafraîchissement");
        return next();
      }
      
      // Pour les autres erreurs, traiter comme un nouvel utilisateur
      socket.userData = { isNew: true };
      next();
    });
});

// Initialisation des gestionnaires de sockets
io.on("connection", async (socket) => {
 console.log(`Nouvelle connexion socket: ${socket.id}`);
 // Gestion prioritaire du rafraîchissement de token
  socket.on("update:refresh_token", async (data) => {
    console.log("🔄 Demande de rafraîchissement de token reçue");
    
    try {
      const parsedData = dataParse(data);
      console.log("Data parsée pour le rafraîchissement:", {
        userId: parsedData.userId,
        hasRefreshToken: !!parsedData.refreshToken,
        hasDeviceId: !!parsedData.deviceId
      });
      
      const result = await refreshUserToken(parsedData);
      
      if (result.error) {
        console.log("❌ Erreur de rafraîchissement:", result.error);
        socket.emit("refresh_error", result.error);
      } else {
        console.log("✅ Token rafraîchi avec succès");
        
        // Mettre à jour les données utilisateur de la socket
        socket.userData = { _id: parsedData.userId };
        
        // Émettre le nouveau token
        socket.emit("token_refreshed", result.tokens);
        
        // Ne PAS déconnecter la socket - laisser le client gérer la reconnexion
        console.log("Token envoyé au client, attente de reconnexion...");
      }
    } catch (error) {
      console.error("❌ Erreur grave lors du rafraîchissement:", error);
      socket.emit("refresh_error", { 
        code: 500, 
        message: "Erreur serveur lors du rafraîchissement" 
      });
    }
  });

    // Émettre le signal de token expiré si nécessaire
  if (socket.userData?.needsRefresh) {
    console.log("🔑 Émission du signal de token expiré");
    socket.emit("expired:token", { message: "Token expiré" });
  }

   // Initialisation pour les utilisateurs authentifiés
  if (socket.userData && socket.userData._id && !socket.userData.isNew) {
    try {
      console.log(`Initialisation utilisateur authentifié: ${socket.userData._id}`);
      await initializeAuthenticatedUser(socket, socket.userData._id);
      await initializeSocketHandlers(socket);
    } catch (error) {
      console.error("Erreur d'initialisation utilisateur:", error);
      return socket.disconnect();
    }
  } else {
    // Utilisateur non authentifié - limiter les événements
    console.log("Utilisateur non authentifié - limitation des événements");
    
    const allowedEvents = new Set([
      ...authEventNames,
      "disconnect",
      "error"
    ]);

    socket.onAny((eventName, ...args) => {
      if (eventName && !allowedEvents.has(eventName.trim())) {
        console.log(`❌ Événement non autorisé pour utilisateur non auth: ${eventName}`);
        return;
      }
    });

    // Pour les nouveaux utilisateurs, ne pas initialiser les handlers complets
    if (!socket.userData?.needsRefresh) {
      // Seuls les handlers d'authentification sont nécessaires
      userHandlers(io, socket);
    }
  }

  console.log(`Utilisateur connecté: ${socket.userData?._id || 'anonyme'}`);
  console.log(`Nombre d'utilisateurs connectés: ${global.connectedUsers.size}`);
});
 

async function initializeSocketHandlers(socket) {
  try {
    await joinUserRooms(socket);
    
    // Initialiser tous les handlers
    userHandlers(io, socket);
    socketMessageHandlers(io, socket);
    setupPaymentSocket(socket);
    setupRoomSocket(io, socket);
    configureBusinessSocket(socket);
    configureStatusSocket(io, socket);
    setupErrorHandlers(socket);
    setupFileShareSocket(socket);
    mediaUploader(socket);
    
    // Envoyer les données initiales
    await sendUnreadNotifications(socket);
    await sendReceivedMessages(socket);
    
    console.log(`✅ Handlers initialisés pour l'utilisateur: ${socket.userData._id}`);
  } catch (error) {
    console.error("❌ Erreur lors de l'initialisation des handlers:", error);
    throw error;
  }
}
/*  console.log(`Utilisateur connecté: ${socket.userData._id}`);
  console.log(`Nombre d'utilisateurs connectés: ${global.connectedUsers.size}`);
    try {
      await joinUserRooms(socket);
  //global.uploadService.registerSocketHandlers(socket);
  userHandlers(io, socket);
  //setupSocketHandlers(io); //une fonction permet de gérer les utilitaires des  utilisateurs
  socketMessageHandlers(io, socket); //on doit utiliser variable globale connectedUsers pour gérer les utilisateurs connectés
  // groupHandlers(io, socket);
  setupPaymentSocket(socket); //on doit utiliser variable globale connectedUsers pour gérer les utilisateurs connectés
  setupRoomSocket(io, socket); //on doit utiliser variable globale connectedUsers pour gérer les utilisateurs connectés
  configureBusinessSocket(socket);
  configureStatusSocket(io, socket);
  setupErrorHandlers(socket);
  setupFileShareSocket(socket);
  mediaUploader(socket);
  await sendUnreadNotifications(socket);
  await sendReceivedMessages(socket);
    } catch (error) {
       console.log("c'est une erreur du serveur : ", error);
    } */
// Mark expired file shares every hour
setInterval(async () => {
  try {
    const count = await markExpiredFileShares();
    console.log(`Marked ${count} file shares as expired`);
  } catch (error) {
    console.error("Error marking expired file shares:", error);
  }
}, 60 * 60 * 1000); // Every hour

// Démarrage du serveur
server.listen(process.env.PORT, () => {
  console.log(`Serveur démarré sur le port ${process.env.PORT}`);
  autoPing();
});
