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
  setupErrorHandlers,
  socketMessageHandlers,
} from "./socket/messageHandlers.js";
import { setupRoomSocket } from "./socket/roomHandlers.js";
import { setupPaymentSocket } from "./controllers/paymentController.js";
import { refreshUserToken, verifyToken } from "./services/authService.js";
import { dataParse } from "./utils/validator.js";
import UploadService from "./config/fileUploader.js";
import { configureBusinessSocket } from "./socket/businessHandlers.js";
import { configureStatusSocket } from "./socket/statusHandlers.js";
import { markExpiredFileShares } from "./services/fileShareService.js";
import { setupFileShareSocket } from "./socket/fileShareHandlers.js";
import http from "http";
dotenv.config();
// Configuration d'Express
const app = express();
const server = http.createServer(app);
const authEvenNames = [
  "verification:code",
  "create_user",
  "resent:verification_code",
  "update:refresh_token",
];

// Configuration de Socket.IO
const io = new SocketIO(server, {
  pingTimeout: 60000, // 60s sans activité avant déconnexion
  pingInterval: 25000, // Envoi de ping toutes les 25s
  maxHttpBufferSize: 1e8, // Taille max des messages (100MB)
  reconnectionAttempts: 5, // Nombre de tentatives de reconnexion
  reconnectionDelay: 1000, //Delai de reconnexion
  transports: ["websocket"], // Force WebSocket uniquement
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

global.uploadService = new UploadService(io);

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
    http.get(process.env.SELF_URL, (res) => {
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
  if (!token) {
    socket.userData = { isNew: true };
    return next();
  }

  verifyToken(token)
    .then((decoded) => {
      socket.userData = { _id: decoded.userId };
      next();
    })
    .catch((error) => {
      socket.onAny((eventName, ...args) => {
        if (eventName && authEvenNames.includes(eventName.trim())) next();
      });
      if (error.name === "TokenExpiredError") {
        socket.emit("expired:token", { message: "Token expiré" });
      }
      socket.userData = { isNew: true };
      next();
    });
});
// Initialisation des gestionnaires de sockets
io.on("connection", async (socket) => {
  // Gestion du rafraîchissement de token
  socket.on("update:refresh_token", async (data) => {
    try {
      const result = await refreshUserToken({
        ...data,
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
      console.error("Erreur d'initialisation utilisateur:", error);
      return socket.disconnect();
    }
  } else {
    // Utilisateur non authentifié, limiter les événements disponibles
    socket.onAny((eventName, ...args) => {
      if (eventName && !authEvenNames.includes(eventName.trim()))
        return socket.disconnect();
    });
  }

  console.log(`Utilisateur connecté: ${socket.userData._id}`);
  console.log(`Nombre d'utilisateurs connectés: ${global.connectedUsers.size}`);
  global.uploadService.registerSocketHandlers(socket);
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
});

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
