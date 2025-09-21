import Alert from "../models/alert.model.js";
import User from "../models/user.model.js";
//import { notifyUsersInRadius } from '../services/notificationService.js';
import { handleMediaUpload } from "../services/mediaService.js";
import Room from "../models/room.model.js";
import Message from "../models/message.model.js";
import { dataParse } from "../utils/validator.js";
import mongoose from "mongoose";
import { getUserSocketId } from "./UserFunctionHandler.js";
import { getUnreadMessages } from "../services/messageService.js";
import Notification from "../models/notification.model.js";
import {
  joinUserRooms,
  userDataToSelect,
} from "../controllers/userController.js";
const activeUploads = new Map();

function generatePrivateAccessCode(userId1, userId2) {
  const sortedIds = [userId1, userId2].sort();
  return `${sortedIds[0]}_${sortedIds[1]}`;
}

//donne moi un fonction qui génère des code d'accès privès de taille comprise entre 6 et 12 caractères (nombre et lettres mélangées si possible) pour une room ou isGroup est true. Elle doit etre unique et non prédictible, veuillez verifier son unicité avant de la retourner
const generateGroupAccessCode = async (accessCodePara = "") => {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  let accessCode = accessCodePara;

  // Si on n'a pas passé de code partiel, on en génère un complet
  if (!accessCodePara) {
    const length = Math.floor(Math.random() * 7) + 6; // Longueur entre 6 et 12
    for (let i = 0; i < length; i++) {
      accessCode += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  }

  // Vérifie si ce code est déjà utilisé
  let isUnique = false;
  while (!isUnique) {
    const existingRoom = await Room.findOne({ accessCode: accessCode });
    if (!existingRoom) {
      isUnique = true;
    } else {
      // Regénère un nouveau code complet si déjà existant
      accessCode = "";
      const length = Math.floor(Math.random() * 7) + 6;
      for (let i = 0; i < length; i++) {
        accessCode += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    }
  }

  return accessCode;
};

// Fonction auxiliaire pour vérifier/créer la room

export default function alertHandlers(io, socket) {
  // Créer une nouvelle alerte
  socket.on("createAlert", async (alertData, callback) => {
    try {
      // Récupérer les informations de l'utilisateur
      const user = await User.findById(socket.userId);
      if (!user) {
        return callback({ error: "Utilisateur non trouvé" });
      }

      // Traiter le média s'il existe
      let mediaUrl = null;
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
      io.to(
        `radius_${Math.floor(newAlert.location.coordinates[0])}_${Math.floor(
          newAlert.location.coordinates[1]
        )}_${Math.ceil(newAlert.radius / 1000)}`
      ).emit("newAlert", {
        alertId: newAlert._id,
        type: newAlert.type,
        description: newAlert.description,
        location: newAlert.location,
        createdAt: newAlert.createdAt,
        mediaUrl: newAlert.mediaUrl,
        creator: {
          id: user._id,
          userPseudo: user.userPseudo,
        },
      });

      callback({
        success: true,
        alertId: newAlert._id,
        notifiedUsers: notifiedUsers.length,
      });
    } catch (error) {
      console.error("Erreur lors de la création d'une alerte:", error);
      callback({ error: "Impossible de créer l'alerte: " + error.message });
    }
  });

  // Confirmer une alerte (signaler qu'elle est réelle)
  socket.on("confirmAlert", async (data, callback) => {
    try {
      const { alertId } = data;

      const alert = await Alert.findById(alertId);
      if (!alert) {
        return callback({ error: "Alerte non trouvée" });
      }

      // Vérifier si l'utilisateur a déjà confirmé cette alerte
      const alreadyConfirmed = alert.confirmations.some(
        (confirmation) => confirmation.user.toString() === socket.userId
      );

      if (!alreadyConfirmed) {
        alert.confirmations.push({ user: socket.userId });
        await alert.save();

        // Émettre un événement pour mettre à jour les compteurs
        io.to(`alert_${alertId}`).emit("alertConfirmation", {
          alertId,
          confirmationsCount: alert.confirmations.length,
        });

        callback({
          success: true,
          confirmationsCount: alert.confirmations.length,
        });
      } else {
        callback({ error: "Vous avez déjà confirmé cette alerte" });
      }
    } catch (error) {
      console.error("Erreur lors de la confirmation d'une alerte:", error);
      callback({ error: "Impossible de confirmer l'alerte: " + error.message });
    }
  });

  // S'abonner aux alertes dans une zone spécifique
  socket.on("subscribeToAreaAlerts", async (data, callback) => {
    try {
      const { coordinates, radius } = data;

      // Valider les coordonnées
      if (!coordinates || coordinates.length !== 2 || !radius) {
        return callback({ error: "Coordonnées ou rayon invalides" });
      }

      // Mettre à jour la localisation de l'utilisateur
      await User.findByIdAndUpdate(socket.userId, {
        "lastLocation.coordinates": coordinates,
        "lastLocation.updatedAt": new Date(),
      });

      // Rejoindre la salle correspondant à la zone géographique
      // Format: radius_longitude_latitude_radiusInKm
      const roomName = `radius_${Math.floor(coordinates[0])}_${Math.floor(
        coordinates[1]
      )}_${Math.ceil(radius / 1000)}`;
      socket.join(roomName);

      // Récupérer les alertes actives dans cette zone
      const activeAlerts = await Alert.find({
        isActive: true,
        expireAt: { $gt: new Date() },
        "location.coordinates": {
          $near: {
            $geometry: {
              type: "Point",
              coordinates: coordinates,
            },
            $maxDistance: radius,
          },
        },
      })
        .populate("creator", "userPseudo")
        .limit(20);

      callback({
        success: true,
        roomName,
        activeAlerts: activeAlerts.map((alert) => ({
          id: alert._id,
          type: alert.type,
          description: alert.description,
          location: alert.location,
          createdAt: alert.createdAt,
          confirmations: alert.confirmations.length,
          mediaUrl: alert.mediaUrl,
          creator: {
            id: alert.creator._id,
            userPseudo: alert.creator.userPseudo,
          },
        })),
      });
    } catch (error) {
      console.error("Erreur lors de l'abonnement aux alertes de zone:", error);
      callback({
        error: "Impossible de s'abonner aux alertes: " + error.message,
      });
    }
  });

  // Se désabonner des alertes d'une zone
  socket.on("unsubscribeFromAreaAlerts", (data, callback) => {
    try {
      const { roomName } = data;
      socket.leave(roomName);
      callback({ success: true });
    } catch (error) {
      callback({ error: "Erreur lors du désabonnement: " + error.message });
    }
  });

  // Rechercher des alertes
  socket.on("searchAlerts", async (data, callback) => {
    try {
      const { coordinates, radius, type, limit = 20 } = data;

      const query = {
        isActive: true,
        expireAt: { $gt: new Date() },
      };

      if (coordinates && coordinates.length === 2) {
        query["location.coordinates"] = {
          $near: {
            $geometry: {
              type: "Point",
              coordinates,
            },
            $maxDistance: radius || 5000, // 5km par défaut
          },
        };
      }

      if (type) {
        query.type = type;
      }

      const alerts = await Alert.find(query)
        .populate("creator", "userPseudo")
        .limit(limit)
        .sort({ createdAt: -1 });

      callback({
        success: true,
        alerts: alerts.map((alert) => ({
          id: alert._id,
          type: alert.type,
          description: alert.description,
          location: alert.location,
          createdAt: alert.createdAt,
          confirmations: alert.confirmations.length,
          mediaUrl: alert.mediaUrl,
          creator: {
            id: alert.creator._id,
            userPseudo: alert.creator.userPseudo,
          },
        })),
      });
    } catch (error) {
      console.error("Erreur lors de la recherche d'alertes:", error);
      callback({
        error: "Impossible de rechercher des alertes: " + error.message,
      });
    }
  });
}

class MessageStatusService {
  static async updateMessagesStatus(data, userId) {
    const { messagesIds, status, receiverId, room } = data;

    // Validation
    if (!messagesIds?.length || !status || !receiverId || !room) {
      throw new Error("Données manquantes");
    }

    if (!["DELIVERED", "READ", "UNREAD"].includes(status)) {
      throw new Error("Status non supporté");
    }

    try {
      // 1. Vérifier que la room existe
      const roomData = await Room.findOne({ id: room });
      if (!roomData) throw new Error("Room introuvable");

      // 2. Mettre à jour les messages
      const updateResult = await Message.updateMany(
        {
          id: { $in: messagesIds },
          // Seulement mettre à jour si le nouveau statut est "supérieur"
          $expr: {
            $lt: [
              {
                $indexOfArray: [
                  ["SENT", "DELIVERED", "UNREAD", "READ"],
                  "$status",
                ],
              },
              {
                $indexOfArray: [
                  ["SENT", "DELIVERED", "UNREAD", "READ"],
                  status,
                ],
              },
            ],
          },
        },
        { $set: { status, updatedAt: new Date() } }
      );

      if (updateResult.modifiedCount === 0) {
        throw new Error("Aucun message mis à jour");
      }

      // 3. Gérer les notifications
      const notification = await this.handleStatusNotification({
        messagesIds,
        status,
        senderId: userId,
        receiverId,
        roomId: roomData._id,
        modifiedCount: updateResult.modifiedCount,
      });

      /*   return {
        success: true,
        modifiedCount: updateResult.modifiedCount,
        roomId: roomData._id,
      }; */
      return notification;
    } catch (error) {
      throw error;
    }
  }

  static async handleStatusNotification(data) {
    const { messagesIds, status, senderId, receiverId, roomId, modifiedCount } =
      data;

    // Stratégie : Une notification par room et par statut, mise à jour plutôt que création multiple
    const existingNotification = await Notification.findOne({
      type: "message_status_changed",
      sender: senderId,
      recipient: receiverId,
      "content.room": roomId,
      "content.status": status,
      status: "CREATED", // Seulement les non-délivrées
    });

    if (existingNotification) {
      // Fusionner les messagesIds et mettre à jour le timestamp
      const uniqueMessageIds = [
        ...new Set([
          ...existingNotification.content.messagesIds,
          ...messagesIds,
        ]),
      ];

      existingNotification.content.messagesIds = uniqueMessageIds;
      existingNotification.content.count = uniqueMessageIds.length;
      existingNotification.updatedAt = new Date();

      await existingNotification.save();
      return existingNotification;
    } else {
      // Créer une nouvelle notification
      const newNotification = new Notification({
        type: "message_status_changed",
        status: "CREATED",
        sender: senderId,
        recipient: receiverId,
        relatedEntity: {
          entityType: "Room",
          entityId: roomId,
        },
        content: {
          room: roomId,
          messagesIds,
          status,
          count: messagesIds.length,
        },
        priority: status === "READ" ? "low" : "normal",
      });

      await newNotification.save();
      return newNotification;
    }
  }
}

export const socketMessageHandlers = (io, socket) => {
  const roomCache = new Map();

  async function ensureRoomExists(socket, upload, session) {
    const cacheKey =
      upload.room?.id || `${socket.userData._id}-${upload.receiver}`;

    // Vérifier le cache d'abord
    if (roomCache.has(cacheKey)) {
      return roomCache.get(cacheKey);
    }

    // Si une room est déjà spécifiée, l'utiliser
    if (upload.room?.id) {
      const checkRoom = await Room.findOne({ id: upload.room.id }).lean();
      if (checkRoom) {
        const result = { room: checkRoom._id, isNew: false };
        roomCache.set(cacheKey, result);
        return result;
      }
    }

    let room;
    let savedRoom;

    if (!upload.isGroup) {
      // Room privée entre deux utilisateurs
      room = new Room({
        ...upload.room,
        members: [socket.userData._id, upload.receiver],
        isGroup: false,
        isPrivate: true,
        accessCode: null,
        creator: socket.userData._id,
      });

      savedRoom = await room.save({ session });

      // Mise à jour des utilisateurs en parallèle
      await Promise.all([
        User.findByIdAndUpdate(
          socket.userData._id,
          { $addToSet: { rooms: savedRoom.id } }, // $addToSet évite les doublons
          { new: true }
        ).session(session),
        User.findByIdAndUpdate(
          upload.receiver,
          { $addToSet: { rooms: savedRoom.id } },
          { new: true }
        ).session(session),
      ]);
    } else {
      // Room de groupe
      const accessCode = await generateGroupAccessCode(upload.room.accessCode);
      room = new Room({
        ...upload.room,
        members: upload.room.members,
        isGroup: true, // Correction: doit être true pour un groupe
        // isPrivate: true,
        accessCode: accessCode,
        creator: socket.userData._id,
      });

      savedRoom = await room.save({ session });

      // Mise à jour de tous les membres en parallèle avec bulkWrite pour plus d'efficacité
      const bulkOps = upload.room.members.map((memberId) => ({
        updateOne: {
          filter: { _id: memberId },
          update: { $addToSet: { rooms: savedRoom.id } },
        },
      }));

      await User.bulkWrite(bulkOps, { session });
    }

    // Joindre les utilisateurs à la room
    socket.join(savedRoom.id.toString());
    console.log(
      "Voici l'id souhaité dans create savedRoom.id.toString() : ",
      savedRoom
    );
    // Joindre le destinataire/membres s'ils sont connectés
    if (!upload.isGroup && global.connectedUsers?.has(upload.receiver)) {
      const receiverSocketId = global.connectedUsers.get(upload.receiver);
      const receiverSocket = io.sockets.sockets.get(receiverSocketId);
      if (receiverSocket) {
        receiverSocket.join(savedRoom.id.toString());
      }
    } else if (upload.isGroup && upload.room.members) {
      // Pour les groupes, joindre tous les membres connectés
      upload.room.members.forEach((memberId) => {
        if (global.connectedUsers?.has(memberId)) {
          const memberSocketId = global.connectedUsers.get(memberId);
          const memberSocket = io.sockets.sockets.get(memberSocketId);
          if (memberSocket) {
            memberSocket.join(savedRoom.id.toString());
          }
        }
      });
    }

    const result = { room: savedRoom._id, isNew: true };
    roomCache.set(cacheKey, result);
    return result;
  }

  socket.on("message:create", async (message) => {
    const session = await mongoose.startSession();
    const messageData = dataParse(message);
    if (!message) {
      socket.emit("message:error", { error: "message incomplet" });
      return;
    }
    try {
      if ("_id" in messageData?.room) delete messageData?.room._id;

      console.log("voici le message recu", messageData);
      const roomInfo = await ensureRoomExists(
        socket,
        {
          receiver: messageData.receiver,
          room: messageData.room,
        },
        session
      );

      const roomkey = messageData.room.id;
      messageData.room = roomInfo.room;
      //verifie que le message n'existe pas déjà en base de donnée
      const checkMessage = await Message.findOne({
        id: messageData.id,
      });
      if (checkMessage) {
        socket.emit("message:error", {
          error: "message déjà existant",
          code: 409,
          status: checkMessage.status,
        });
        return;
      }
      const newMessage = new Message({
        sender: socket.userData._id,
        ...messageData,
      });

      const filterData = userDataToSelect(messageData.sender, message.receiver);
      const savedMessage = await newMessage.save({ session });
      const populatedMessage = await Message.findById(savedMessage._id)
        .populate([
          { path: "sender", select: filterData },
          { path: "receiver", select: filterData },
        ])
        .populate("room")
        .lean(); //68cb438bea019499c3f78cf768cb3c11ea019499c3f78c70
      console.log(
        "message:created événement pour roomKey : ",
        roomkey,
        " ajouter un user au room ",
        roomInfo.room,
        " voici le reste contenu du message serveur ",
        populatedMessage,
        " et celle venant du client ",
        messageData
      );
      io.to(roomkey).emit("newMessage", populatedMessage);
      socket.emit("message:created", {
        code: 200,
        message: "Message enregistré dans la db",
      });
    } catch (error) {
      console.error("Erreur lors de l'envoi du message texte:", error);
      socket.emit("message:error", { error: error.message });
    } finally {
      session.endSession();
    }
  });
  /*
  socket.on("updateMessagesStatus", async (messageData, callback) => {
    const parsed = dataParse(messageData);
    if (!parsed) {
      return callback({ error: "Données introuvables", code: 400 });
    }

    try {
      const { messagesIds, status, receiverId, room } = parsed;
      //entityId = _id du room
      if (!messagesIds || !status || !receiverId || !room) {
        return callback({ error: "Données manquantes", code: 400 });
      }
      const roomData = await Room.findOne({ id: room });
      if (!roomData) return callback({ error: "Room introuvable", code: 400 });

      await Message.updateMany(
        { id: { $in: messagesIds } },
        { $set: { status } }
      );
      let newNotification;
      //Nous allons d'abord vérifier si une le status est "DELIVERED" ou "SEEN", Si DELIVERED, on crée une notification sinon on motifie la notification existante;
      if (status !== "DELIVERED" && status !== "READ" && status != "UNREAD")
        return callback({ error: "Status non supporté", code: 400 });
      if (status === "DELIVERED") {
        newNotification = new Notification({
          type: "message_status_changed",
          status: "CREATED",
          sender: socket.userData._id,
          recipient: receiverId,
          relatedEntity: "Room",
          entityId: roomData._id,
          content: { room: roomData._id, messagesIds , status }, //messageIds est un tableau
        });
      } else {
        newNotification = await Notification.findOneAndUpdate(
          {
            type: "message_status_changed",
            sender: socket.userData._id,
            recipient: receiverId,
            relatedEntity: "Room",
            entityId: roomData._id,
            "content.room": roomData._id,
            "content.status": status,
          }
        );
        
      }

      await newNotification.save();

      io.to(room.toString()).emit("newNotifications", {
        notifications: [newNotification],
      });

      callback({ message: "Mise à jour réussie", code: 200 });
    } catch (err) {
      console.error("Erreur lors de updateMany:", err);
      return callback({
        message: "Une erreur est survenue",
        error: err.message,
        code: 500,
      });
    }
  }); */

  socket.on("updateMessagesStatus", async (messageData, callback) => {
    const parsed = dataParse(messageData);
    if (!parsed) {
      return callback({ error: "Données introuvables", code: 400 });
    }

    try {
      const result = await MessageStatusService.updateMessagesStatus(
        parsed,
        socket.userData._id
      );

      // Émettre la notification seulement en cas de succès
      if (result) {
        // Émettre à la room concernée
        /*  io.to(parsed.room.toString()).emit("messagesStatusUpdated", {
          messagesIds: parsed.messagesIds,
          status: parsed.status,
          sendBy: socket.userData._id,
        }); */
        io.to(parsed.room.toString()).emit("messagesStatusUpdated", {
          notification: result,
         /* messagesIds: parsed.messagesIds,
          status: parsed.status, */
          sendBy: socket.userData._id?.toString(), 
          code : 200
        });
      }

      callback({ message: "Mise à jour réussie", code: 200 });
    } catch (error) {
      console.error("Erreur updateMessagesStatus:", error);
      callback({
        message: error.message || "Une erreur est survenue",
        code: error.message === "Données manquantes" ? 400 : 500,
      });
    }
  });

  socket.on("updateNotificationStatus", async (notificationData, callback) => {
    const parsedData = dataParse(notificationData);
    if (!parsedData) {
      return callback({ error: "Données manquantes", code: 400 });
    }

    const { notificationId, status } = parsedData;
    if (!notificationId || !status) {
      return callback({ error: "Données manquantes", code: 400 });
    }

    try {
      const notification = await Notification.findByIdAndUpdate(
        notificationId,
        { status: status },
        { new: true }
      );

      if (!notification) {
        return callback({ error: "Notification non trouvée", code: 404 });
      }

      callback({
        success: true,
        data: notification,
        message: "Statut de la notification mis à jour avec succès",
      });
    } catch (error) {
      console.error("Erreur lors de la mise à jour de la notification:", error);
      callback({
        error: "Erreur serveur lors de la mise à jour",
        code: 500,
      });
    }
  });

  socket.on("fetchNewMessages", async ({ roomId }) => {
    const roomObjectId = new mongoose.Types.ObjectId(String(roomId));
    const userId = new mongoose.Types.ObjectId(String(socket.userData._id));

    try {
      const aggregationPipeline = [
        {
          $match: {
            room: roomObjectId,
            receivedBy: { $nin: [userId] },
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "sender",
            foreignField: "_id",
            as: "sender",
          },
        },
        { $unwind: "$sender" },
        {
          $lookup: {
            from: "rooms",
            localField: "room",
            foreignField: "_id",
            as: "room",
          },
        },
        { $unwind: "$room" },
        {
          $match: {
            $or: [
              { "room.isPrivate": false },
              {
                "room.isPrivate": true,
                $expr: { $eq: ["$receiver", userId] },
              },
            ],
          },
        },
        {
          $project: {
            "sender.wallet": 0,
            "sender.profile.profileViewers": 0,
            "sender.profile.statusViewers": 0,
            "sender.statusShared": 0,
            "sender.phone": 0,
            "sender.email": 0,
            "room.members": 0,
            "room.wallet": 0,
            receivedBy: 0,
            seenBy: 0,
          },
        },
        { $sort: { createdAt: 1 } },
      ];

      const userMessages = await Message.aggregate(aggregationPipeline);

      socket.emit("newMessages", userMessages);
    } catch (error) {
      console.error("Error:", error);
      socket.emit("fetchNewMessages:error", {
        error: error.message,
        code: error.code || "DATABASE_ERROR",
      });
    }
  });
};

export const initializeAuthenticatedUser = async (socket, userId) => {
  const userData = await User.findOne({ _id: userId });

  if (!userData) {
    throw new Error("Utilisateur non trouvé");
  }

  socket.userData = {
    ...socket.userData,
    userName: userData.userPseudo,
    KSD: userData.KSD,
  };

  // Rejoindre toutes les rooms
  userData.rooms.forEach((roomId) => {
    socket.join(roomId.toString());
  });

  // Récupérer les messages et notifications non lus
  await sendPendingCommunications(socket, userData);

  // Ajouter l'utilisateur à la liste des connectés
  if (!global.connectedUsers.has(userId)) {
    global.connectedUsers.set(userId, socket.id);
  }

  console.log(`Utilisateur connecté: ${userId}`);
  console.log(`Nombre d'utilisateurs connectés: ${global.connectedUsers.size}`);
};

export const sendPendingCommunications = async (socket, userData) => {
  try {
    const [messages, notifications, groupMessages] = await Promise.all([
      Message.find({ receiver: userData._id, status: "SENT" }),
      Notification.find({ recipient: userData._id, status: "CREATED" }),
      getUnreadMessages(userData._id, userData.rooms),
    ]);

    if (messages.length > 0) socket.emit("newMessages", messages);
    if (notifications.length > 0)
      socket.emit("newNotifications", notifications);
    if (groupMessages.length > 0)
      socket.emit("newGroupMessages", groupMessages);
  } catch (error) {
    console.error("Erreur lors de la récupération des communications:", error);
    throw error;
  }
};

export const setupErrorHandlers = (socket) => {
  socket.on("connect_error", (error) => {
    console.error("Erreur de connexion:", error.message);

    if (error.message.includes("WebSocket")) {
      console.log("⚠️ Échec de WebSocket - Basculement vers polling...");
    }

    if (error.message.includes("timeout")) {
      console.log("⚠️ Délai de connexion dépassé");
    }
  });

  socket.on("reconnect", async (attempt) => {
    await joinUserRooms(socket);
    console.log(`Reconnecté avec succès après ${attempt} tentative(s)`);
  });
  socket.on("disconnect", () => {
    global.connectedUsers.delete(socket.userData?._id?.toString());
  });
};

export const sendReceivedMessages = async (socket) => {
  socket.on("getNewMessages", async (data) => {
    console.log(
      " l'utilisateur veux récupérer ses informations : getNewMessages data",
      data
    );
    try {
      const newMessages = await Message.getReceivedMessages(
        socket.userData._id
      );
      socket.emit("newMessages", { messages: newMessages, code: 200 });
    } catch (error) {
      console.error("Erreur lors de la récupération des messages :", error);
    }
  });
};
