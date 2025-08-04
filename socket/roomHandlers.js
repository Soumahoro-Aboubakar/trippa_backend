import Room from "../models/room.model.js";
import mongoose from "mongoose";
import Payment from "../models/payment.model.js";
import User from "../models/user.model.js";
import { createNotification } from "../services/notificationService.js";
import { dataParse } from "../utils/validator.js";
import { sendNotificationToUsers } from "./UserFunctionHandler.js";
import {
  advandedRoomSearch,
  getRommByAccessCode,
} from "../controllers/roomController.js";

// Configuration des événements socket
export function setupRoomSocket(io, socket) {
  socket.on("get_rooms_by_search", (data, callback) => {
    handleAdvancedRoomSearch(socket, data, callback);
  });

  socket.on("get_room_by_access_code", (data, callback) => {
    handleGetRoomByAccessCode(socket, data, callback);
  });

  socket.on("create_room", (data, callback) => {
    handleCreateRoom(socket, data, callback);
  });

  socket.on("join_room", (data, callback) => {
    handleJoinRoom(socket, io, data, callback);
  });

  socket.on("update_room", (data, callback) => {
    handleUpdateRoom(socket, io, data, callback);
  });

  socket.on("leave_room", (data, callback) => {
    handleLeaveRoom(socket, io, data, callback);
  });

  socket.on("kick_member", (data, callback) => {
    handleKickMember(socket, io, data, callback);
  });

  socket.on("ban_member", (data, callback) => {
    handleBanMember(socket, io, data, callback);
  });

  socket.on("add_group_admin", (data, callback) => {
    handleAddGroupAdmin(socket, data, callback);
  });

  socket.on("find_nearby_groups", (data, callback) => {
    handleFindNearbyGroups(socket, data, callback);
  });

  socket.on("rate_group", (data, callback) => {
    handleRateGroup(socket, io, data, callback);
  });

  socket.on("request_room_refund", (data, callback) => {
    handleRequestRoomRefund(socket, io, data, callback);
  });
}

// Handlers pour chaque événement

export async function handleAdvancedRoomSearch(socket, data, callback) {
  try {
    advandedRoomSearch(data, callback);
  } catch (error) {
    console.log("Erreur lors de la recherche avancée:", error);
    callback({ error: "Erreur serveur", details: error.message });
  }
}

export async function handleGetRoomByAccessCode(socket, data, callback) {
  try {
    const parsedData = {
      ...dataParse(data),
      userId: socket.userData?._id,
    };
    getRommByAccessCode(parsedData, callback);
  } catch (error) {
    console.log("Erreur lors de la récupération par code d'accès:", error);
    callback({ error: "Erreur serveur", details: error.message });
  }
}
/*
export async function handleCreateRoom(socket, roomData, callback) {
  try {
    // Validation des données d'entrée
    if (!socket.userData?._id) {
      return callback({ error: "Utilisateur non authentifié" });
    }

    // Extraction et validation des paramètres
    const {
      isPaid = false,
      isPrivate = false,
      price = 0,
      accessCode = null,
      refundPeriodDays = 0,
      members = [],
      ...otherRoomData
    } = roomData;

    // Validation pour les rooms payantes
    if (isPaid && (!price || price <= 0)) {
      return callback({ error: "Les salles payantes doivent avoir un prix valide supérieur à 0" });
    }

    // Validation pour les rooms privées
    if (isPrivate && !accessCode) {
      return callback({ error: "Les salles privées doivent avoir un code d'accès" });
    }

    // Création de la nouvelle room
    const newRoom = new Room({
      ...otherRoomData,
      creator: socket.userData._id,
      members: [socket.userData._id],
      admins: [socket.userData._id],
      isGroup: true,
      isPaid,
      isPrivate,
      price,
      accessCode,
      refundPeriodDays,
      wallet: {
        balance: 0,
        transactions: [],
      },
    });

    const savedRoom = await newRoom.save();
    await savedRoom.populate("members", "username profile KSD");
    await savedRoom.populate("admins", "username profile KSD");

    // Rejoindre la room socket
    socket.join(savedRoom._id.toString());

    callback({ success: true, room: savedRoom });
  } catch (error) {
    console.log("Erreur lors de la création de la room:", error);
    callback({ error: "Erreur lors de la création", details: error.message });
  }
}*/

/**
 * Génère un code d'accès unique pour une room
 * @param {number} length - Longueur du code (entre 6 et 12)
 * @returns {string} Code d'accès aléatoire
 */
function generateAccessCode(length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Génère un code d'accès unique qui n'existe pas déjà en base
 * @param {number} maxAttempts - Nombre maximum de tentatives
 * @returns {Promise<string>} Code d'accès unique
 */
async function generateUniqueAccessCode(maxAttempts = 10) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Commencer avec 8 caractères, augmenter si collision
    const codeLength = 8 + attempt;
    const code = generateAccessCode(codeLength);
    
    // Vérifier si le code existe déjà
    const existingRoom = await Room.findOne({ accessCode: code });
    
    if (!existingRoom) {
      return code;
    }
  }
  
  // Si on n'arrive pas à générer un code unique après maxAttempts
  throw new Error('Impossible de générer un code d\'accès unique');
}

/**
 * Valide et traite les données d'entrée pour la création d'une room
 * @param {Object} roomData - Données de la room
 * @param {string} userId - ID de l'utilisateur créateur
 * @returns {Object} Données validées et traitées
 */
async function validateAndProcessRoomData(roomData, userId) {
  const {
    isPaid = false,
    isPrivate = false,
    price = 0,
    accessCode = null,
    refundPeriodDays = 0,
    members = [],
    roomType = "private",
    ...otherRoomData
  } = roomData;

  // Validation pour les rooms payantes
  if (isPaid && (!price || price <= 0)) {
    throw new Error("Les salles payantes doivent avoir un prix valide supérieur à 0");
  }

  // Validation de la période de remboursement
  if (isPaid && (refundPeriodDays < 0 || refundPeriodDays > 30)) {
    throw new Error("La période de remboursement doit être entre 0 et 30 jours");
  }

  // Gestion du code d'accès
  let finalAccessCode = null;
  
  if (roomType != "private") {
    if (accessCode) {
      // Vérifier si le code fourni est déjà utilisé
      const existingRoom = await Room.findOne({ accessCode });
      if (existingRoom) {
        // Générer un nouveau code si celui fourni existe déjà
        finalAccessCode = await generateUniqueAccessCode();
      } else {
        // Valider le format du code fourni
        if (!/^[A-Z0-9]{6,12}$/.test(accessCode)) {
          throw new Error("Le code d'accès doit contenir 6-12 caractères alphanumériques majuscules");
        }
        finalAccessCode = accessCode;
      }
    } else {
      // Générer automatiquement un code pour les rooms privées
      finalAccessCode = await generateUniqueAccessCode();
    }
  }

  // Traitement des membres
  const processedMembers = members.length > 0 
    ? [...new Set([userId, ...members.map(id => id.toString())])]
        .map(id => new mongoose.Types.ObjectId(id))
    : [new mongoose.Types.ObjectId(userId)];

  return {
    ...otherRoomData,
    isPaid,
    isPrivate: isPrivate || roomType === "private",
    price: isPaid ? price : 0,
    accessCode: finalAccessCode,
    refundPeriodDays: isPaid ? refundPeriodDays : 0,
    members: processedMembers,
    roomType,
    creator: new mongoose.Types.ObjectId(userId),
    admins: [new mongoose.Types.ObjectId(userId)]
  };
}

/**
 * Gère la création d'une nouvelle room avec validation et génération automatique de code
 * @param {Object} socket - Socket de l'utilisateur
 * @param {Object} roomData - Données de la room à créer
 * @param {Function} callback - Fonction de callback
 */
export async function handleCreateRoom(socket, roomData, callback) {
  try {
    // Validation de l'authentification
    if (!socket.userData?._id) {
      return callback({ 
        error: "Utilisateur non authentifié",
        code: "AUTH_REQUIRED"
      });
    }

    // Validation et traitement des données
    const processedData = await validateAndProcessRoomData(roomData, socket.userData._id);

    // Création de la nouvelle room
    const newRoom = new Room({
      ...processedData,
      isGroup: true,
      wallet: {
        balance: 0,
        transactions: []
      }
    });

    // Sauvegarde avec gestion des erreurs de validation Mongoose
    const savedRoom = await newRoom.save();

    // Population des références
    await savedRoom.populate([
      { path: "members", select: "username profile KSD" },
      { path: "admins", select: "username profile KSD" },
      { path: "creator", select: "username profile KSD" }
    ]);

    // Rejoindre la room socket
    socket.join(savedRoom._id.toString());

    // Log pour le suivi
    console.log(`Room créée avec succès: ${savedRoom.name} (${savedRoom._id}) par ${socket.userData.username}`);
    
    // Si un nouveau code a été généré, l'indiquer dans la réponse
    const response = {
      success: true,
      room: savedRoom
    };

    // Informer si le code d'accès a été modifié/généré
    if (roomData.accessCode && roomData.accessCode !== savedRoom.accessCode) {
      response.message = "Un nouveau code d'accès a été généré car celui fourni était déjà utilisé";
      response.generatedAccessCode = savedRoom.accessCode;
    } else if (!roomData.accessCode && savedRoom.accessCode) {
      response.message = "Code d'accès généré automatiquement";
      response.generatedAccessCode = savedRoom.accessCode;
    }

    callback(response);

  } catch (error) {
    console.error("Erreur lors de la création de la room:", {
      error: error.message,
      stack: error.stack,
      roomData: { ...roomData, accessCode: '[HIDDEN]' }, // Masquer le code dans les logs
      userId: socket.userData?._id
    });

    // Gestion des erreurs spécifiques
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return callback({ 
        error: "Données invalides", 
        details: validationErrors,
        code: "VALIDATION_ERROR"
      });
    }

    if (error.code === 11000) { // Erreur de duplication MongoDB
      return callback({ 
        error: "Une salle avec ces caractéristiques existe déjà",
        code: "DUPLICATE_ERROR"
      });
    }

    callback({ 
      error: "Erreur lors de la création de la salle", 
      details: process.env.NODE_ENV === 'development' ? error.message : "Erreur interne",
      code: "INTERNAL_ERROR"
    });
  }
}

export async function handleJoinRoom(socket, io, data, callback) {
  const session = await mongoose.startSession();
  
  try {
    const { roomId, accessCode, paymentMethod } = data;

    if (!roomId) {
      return callback({ error: "ID de la room manquant" });
    }

    if (!socket.userData?._id) {
      return callback({ error: "Utilisateur non authentifié" });
    }

    // Rechercher la room
    const room = await Room.findById(roomId).session(session);
    if (!room) {
      return callback({ error: "Room non trouvée" });
    }

    // Vérifier si l'utilisateur est déjà membre
    if (room.members.includes(socket.userData._id)) {
      return callback({ error: "Vous êtes déjà membre de cette room" });
    }

    // Vérifier le code d'accès pour les rooms privées
    if (room.isPrivate && room.accessCode !== accessCode) {
      return callback({ error: "Code d'accès invalide" });
    }

    // Gestion du paiement pour les rooms payantes
    if (room.isPaid) {
      const user = await User.findById(socket.userData._id)
        .session(session)
        .select("wallet");

      if (!user || user.wallet.balance < room.price) {
        return callback({ error: "Solde insuffisant pour rejoindre cette room payante" });
      }

      // Créer l'enregistrement de paiement
      const payment = new Payment({
        user: socket.userData._id,
        recipient: room.creator,
        amount: room.price,
        currency: "coins",
        type: "room_subscription",
        status: "completed",
        paymentMethod,
        relatedEntity: {
          entityType: "room",
          entityId: room._id,
        },
        refundable: true,
        refundableBefore: room.refundPeriodDays
          ? new Date(Date.now() + room.refundPeriodDays * 24 * 60 * 60 * 1000)
          : null,
      });

      await payment.save({ session });

      // Déduire du solde de l'utilisateur
      user.wallet.balance -= room.price;
      user.wallet.transactions.push(payment._id);
      await user.save({ session });

      // Ajouter au solde du créateur
      const creator = await User.findById(room.creator)
        .session(session)
        .select("wallet");

      if (creator) {
        creator.wallet.balance += room.price;
        creator.wallet.transactions.push(payment._id);
        await creator.save({ session });
      }

      // Ajouter au portefeuille de la room
      room.wallet.balance += room.price;
      room.wallet.transactions.push(payment._id);
    }

    // Ajouter l'utilisateur aux membres
    room.members.push(socket.userData._id);
    const updatedRoom = await room.save({ session });

    // Rejoindre la room socket
    socket.join(roomId);

    // Peupler les données des membres
    await updatedRoom.populate("members", "username profile KSD");

    // Ajouter la room à l'utilisateur
    const user = await User.findById(socket.userData._id).session(session);
    if (user && !user.rooms.includes(roomId)) {
      user.rooms.push(roomId);
      await user.save({ session });
    }

    // Créer les notifications
    const notificationPromises = room.members
      .filter(memberId => memberId.toString() !== socket.userData._id.toString())
      .map(async (memberId) =>
        await createNotification({
          recipient: memberId,
          type: "room_update",
          content: {
            title: "Nouveau membre",
            message: `${socket.userData.userName} a rejoint la room "${room.name}"`,
            roomId: room._id,
          },
        })
      );

    const notifications = await Promise.all(notificationPromises);
    await sendNotificationToUsers(io, notifications, global.connectedUsers);

    // Notification de paiement si applicable
    if (room.isPaid) {
      const paymentNotif = await createNotification({
        recipient: socket.userData._id,
        type: "payment_update",
        content: {
          title: "Accès room acheté",
          message: `Vous avez rejoint avec succès la room payante "${room.name}" pour ${room.price} coins.`,
          roomId: room._id,
        },
      });
      await sendNotificationToUsers(io, [paymentNotif], global.connectedUsers);
    }

    callback({ success: true, room: updatedRoom });
  } catch (error) {
    console.log("Erreur lors de la jointure à la room:", error);
    callback({ 
      error: error.message.includes("Solde insuffisant") ? "INSUFFICIENT_BALANCE" :
             error.message.includes("Code d'accès invalide") ? "INVALID_ACCESS_CODE" : 
             "JOIN_FAILURE",
      message: error.message 
    });
  } finally {
    session.endSession();
  }
}

export async function handleUpdateRoom(socket, io, data, callback) {
  try {
    const { roomId, updates } = data;

    if (!roomId || !updates) {
      return callback({ error: "Données manquantes pour la mise à jour" });
    }

    if (!socket.userData?._id) {
      return callback({ error: "Utilisateur non authentifié" });
    }

    const room = await Room.findById(roomId);
    if (!room) {
      return callback({ error: "Room non trouvée" });
    }

    if (!room.admins.includes(socket.userData._id)) {
      return callback({ error: "Non autorisé: Seuls les admins peuvent modifier la room" });
    }

    // Restrictions sur les modifications
    const allowedUpdates = { ...updates };
    delete allowedUpdates.members; // Les membres ne peuvent pas être modifiés via cette méthode
    
    // Seul le créateur peut modifier le prix
    if (socket.userData._id.toString() !== room.creator.toString()) {
      delete allowedUpdates.price;
    }

    const updatedRoom = await Room.findByIdAndUpdate(
      roomId,
      { $set: allowedUpdates },
      { new: true }
    ).populate("members", "username profile KSD");

    // Diffuser la mise à jour
    io.to(roomId).emit("room_updated", updatedRoom);

    callback({ success: true, room: updatedRoom });
  } catch (error) {
    console.log("Erreur lors de la mise à jour de la room:", error);
    callback({ error: "Erreur lors de la mise à jour", details: error.message });
  }
}

export async function handleLeaveRoom(socket, io, data, callback) {
  const session = await mongoose.startSession();

  try {
    const { roomId } = data;

    if (!roomId) {
      return callback({ error: "ID de la room manquant" });
    }

    if (!socket.userData?._id) {
      return callback({ error: "Utilisateur non authentifié" });
    }

    const room = await Room.findById(roomId).session(session);
    if (!room) {
      return callback({ error: "Room non trouvée" });
    }

    // Vérifier si l'utilisateur est membre
    if (!room.members.some(member => member.toString() === socket.userData._id.toString())) {
      return callback({ error: "Vous n'êtes pas membre de cette room" });
    }

    const isAdmin = room.admins.some(admin => admin.toString() === socket.userData._id.toString());
    const isOnlyAdmin = isAdmin && room.admins.length === 1;

    // Gérer la transition d'admin si nécessaire
    if (isOnlyAdmin && room.members.length > 1) {
      const otherMembers = room.members.filter(
        member => member.toString() !== socket.userData._id.toString()
      );

      if (otherMembers.length > 0) {
        room.admins = [otherMembers[0]];
        
        // Notifier le nouvel admin
        const adminNotification = await createNotification({
          recipient: otherMembers[0],
          type: "room_update",
          content: {
            title: "Nouveau rôle administrateur",
            message: `Vous êtes désormais administrateur de la room "${room.name}"`,
            roomId: room._id,
          },
        });
        await sendNotificationToUsers(io, [adminNotification], global.connectedUsers);
      }
    } else if (room.members.length === 1) {
      // Supprimer la room si c'est le dernier membre et pas de solde
      if (room.wallet.balance <= 0) {
        await Room.findByIdAndDelete(roomId).session(session);
        socket.leave(roomId);
        return callback({ success: true, message: "Room supprimée car vous étiez le dernier membre" });
      }
    } else if (isAdmin) {
      // Retirer des admins si ce n'est pas le seul
      room.admins = room.admins.filter(
        admin => admin.toString() !== socket.userData._id.toString()
      );
    }

    // Retirer l'utilisateur des membres
    room.members = room.members.filter(
      member => member.toString() !== socket.userData._id.toString()
    );

    await room.save({ session });

    // Quitter la room socket
    socket.leave(roomId);

    // Notifications aux autres membres
    const notificationPromises = room.members.map(async (memberId) =>
      await createNotification({
        recipient: memberId,
        type: "room_update",
        content: {
          title: "Membre parti",
          message: `${socket.userData.userName} (KSD:${socket.userData.KSD}) a quitté la room "${room.name}"`,
          roomId: room._id,
        },
      })
    );

    const notifications = await Promise.all(notificationPromises);
    await sendNotificationToUsers(io, notifications, global.connectedUsers);

    callback({ success: true, message: "Vous avez quitté la room avec succès" });
  } catch (error) {
    console.log("Erreur lors de la sortie de la room:", error);
    callback({ error: "Erreur lors de la sortie", details: error.message });
  } finally {
    session.endSession();
  }
}

export async function handleKickMember(socket, io, data, callback) {
  const session = await mongoose.startSession();

  try {
    const { roomId, userId } = data;

    if (!roomId || !userId) {
      return callback({ error: "Données manquantes" });
    }

    if (!socket.userData?._id) {
      return callback({ error: "Utilisateur non authentifié" });
    }

    const room = await Room.findById(roomId).session(session);
    if (!room) {
      return callback({ error: "Room non trouvée" });
    }

    // Vérifier les permissions d'admin
    if (!room.admins.some(admin => admin.toString() === socket.userData._id.toString())) {
      return callback({ error: "Seuls les administrateurs peuvent expulser des membres" });
    }

    // Vérifier si l'utilisateur est membre
    if (!room.members.some(member => member.toString() === userId)) {
      return callback({ error: "Cet utilisateur n'est pas membre de la room" });
    }

    // Empêcher l'expulsion d'un admin
    if (room.admins.some(admin => admin.toString() === userId)) {
      return callback({ error: "Impossible d'expulser un administrateur" });
    }

    // Retirer l'utilisateur
    room.members = room.members.filter(member => member.toString() !== userId);
    await room.save({ session });

    // Notifications
    const notificationPromises = room.members.map(async (memberId) =>
      await createNotification({
        recipient: memberId,
        type: "room_update",
        content: {
          title: "Membre expulsé",
          message: `Un membre a été expulsé de la room "${room.name}"`,
          roomId: room._id,
        },
      })
    );

    const kickedNotification = await createNotification({
      recipient: userId,
      type: "room_update",
      content: {
        title: "Expulsé de la room",
        message: `Vous avez été expulsé de la room "${room.name}"`,
        roomId: room._id,
      },
    });

    const notifications = await Promise.all(notificationPromises);
    await sendNotificationToUsers(io, [...notifications, kickedNotification], global.connectedUsers);

    callback({ success: true, message: "Membre expulsé avec succès" });
  } catch (error) {
    console.log("Erreur lors de l'expulsion:", error);
    callback({ error: "Erreur lors de l'expulsion", details: error.message });
  } finally {
    session.endSession();
  }
}

export async function handleBanMember(socket, io, data, callback) {
  const session = await mongoose.startSession();

  try {
    const { roomId, userId, reason } = data;

    if (!roomId || !userId) {
      return callback({ error: "Données manquantes" });
    }

    if (!socket.userData?._id) {
      return callback({ error: "Utilisateur non authentifié" });
    }

    const room = await Room.findById(roomId).session(session);
    if (!room) {
      return callback({ error: "Room non trouvée" });
    }

    // Vérifier les permissions
    if (!room.admins.some(admin => admin.toString() === socket.userData._id.toString())) {
      return callback({ error: "Seuls les administrateurs peuvent bannir des membres" });
    }

    // Empêcher le bannissement d'un admin
    if (room.admins.some(admin => admin.toString() === userId)) {
      return callback({ error: "Impossible de bannir un administrateur" });
    }

    // Retirer des membres s'il y est
    const isMember = room.members.some(member => member.toString() === userId);
    if (isMember) {
      room.members = room.members.filter(member => member.toString() !== userId);
    }

    // Ajouter à la liste des bannis
    if (!room.bannedUsersFromRoom) {
      room.bannedUsersFromRoom = [];
    }

    if (!room.bannedUsersFromRoom.some(ban => ban.userId.toString() === userId)) {
      room.bannedUsersFromRoom.push({
        userId,
        bannedBy: socket.userData._id,
        reason: reason || "Aucune raison spécifiée",
        bannedAt: new Date(),
        isActive: true,
      });
    }

    await room.save({ session });

    // Notifications
    const notificationPromises = room.members.map(async (memberId) =>
      await createNotification({
        recipient: memberId,
        type: "room_update",
        content: {
          title: "Membre banni",
          message: `Un membre a été banni de la room "${room.name}". Raison: ${reason || "Aucune raison spécifiée"}`,
          roomId: room._id,
        },
      })
    );

    const bannedNotification = await createNotification({
      recipient: userId,
      type: "room_update",
      content: {
        title: "Bannissement de room",
        message: `Vous avez été banni de la room "${room.name}". Raison: ${reason || "Aucune raison spécifiée"}`,
        roomId: room._id,
      },
    });

    const notifications = await Promise.all(notificationPromises);
    await sendNotificationToUsers(io, [...notifications, bannedNotification], global.connectedUsers);

    callback({ success: true, message: "Membre banni avec succès" });
  } catch (error) {
    console.log("Erreur lors du bannissement:", error);
    callback({ error: "Erreur lors du bannissement", details: error.message });
  } finally {
    session.endSession();
  }
}

export async function handleAddGroupAdmin(socket, data, callback) {
  try {
    const { roomId, newAdminId } = data;

    if (!roomId || !newAdminId) {
      return callback({ error: "Informations incomplètes" });
    }

    if (!socket.userData?._id) {
      return callback({ error: "Utilisateur non authentifié" });
    }

    const group = await Room.findById(roomId);
    if (!group) {
      return callback({ error: "Room non trouvée" });
    }

    // Vérifier les permissions
    if (!group.admins.includes(socket.userData._id)) {
      return callback({ error: "Vous n'êtes pas administrateur de ce groupe" });
    }

    // Vérifier si l'utilisateur est membre
    if (!group.members.includes(newAdminId)) {
      return callback({ error: "L'utilisateur n'est pas membre du groupe" });
    }

    // Vérifier s'il n'est pas déjà admin
    if (group.admins.includes(newAdminId)) {
      return callback({ error: "L'utilisateur est déjà administrateur du groupe" });
    }

    const updatedGroup = await Room.findByIdAndUpdate(
      roomId,
      { $addToSet: { admins: newAdminId } },
      { new: true }
    );

    callback({
      success: true,
      message: "Administrateur ajouté avec succès",
      group: updatedGroup,
    });
  } catch (error) {
    console.log("Erreur lors de l'ajout d'admin:", error);
    callback({ error: "Erreur lors de l'ajout d'admin", details: error.message });
  }
}

export async function handleFindNearbyGroups(socket, data, callback) {
  try {
    const { coordinates, radius = 1000, userId } = data;

    if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
      return callback({ error: "Coordonnées invalides" });
    }

    const query = {
      "location.coordinates": {
        $near: {
          $geometry: {
            type: "Point",
            coordinates,
          },
          $maxDistance: radius,
        },
      },
    };

    // Gérer la visibilité
    if (userId) {
      query.$or = [
        { isPrivate: false },
        { isPrivate: true, members: userId },
      ];
    } else {
      query.isPrivate = false;
    }

    const nearbyGroups = await Room.find(query)
      .select("name description photo location members averageRating")
      .populate("members", "userPseudo profile.photo")
      .limit(20);

    callback({
      success: true,
      groups: nearbyGroups,
      count: nearbyGroups.length,
      radius,
    });
  } catch (error) {
    console.log("Erreur lors de la recherche de groupes à proximité:", error);
    callback({ error: "Erreur lors de la recherche de groupes", details: error.message });
  }
}

export async function handleRateGroup(socket, io, data, callback) {
  try {
    const { roomId, rating, comment = "" } = data;

    if (!roomId || rating === undefined || rating < 1 || rating > 5) {
      return callback({ error: "Informations d'évaluation invalides" });
    }

    if (!socket.userData?._id) {
      return callback({ error: "Utilisateur non authentifié" });
    }

    const group = await Room.findById(roomId);
    if (!group) {
      return callback({ error: "Groupe non trouvé" });
    }

    // Vérifier l'appartenance
    if (!group.members.includes(socket.userData._id)) {
      return callback({ error: "Vous devez être membre du groupe pour l'évaluer" });
    }

    // Gérer l'évaluation
    const existingRatingIndex = group.ratings.findIndex(
      (r) => r.user && r.user.toString() === socket.userData._id.toString()
    );

    if (existingRatingIndex !== -1) {
      // Mettre à jour
      group.ratings[existingRatingIndex].rating = rating;
      group.ratings[existingRatingIndex].comment = comment;
      group.ratings[existingRatingIndex].createdAt = new Date();
    } else {
      // Ajouter nouveau
      group.ratings.push({
        user: socket.userData._id,
        rating,
        comment,
        createdAt: new Date(),
      });
    }

    // Recalculer la moyenne
    if (group.ratings.length > 0) {
      const totalRating = group.ratings.reduce((sum, r) => sum + r.rating, 0);
      group.averageRating = totalRating / group.ratings.length;
    }

    const updatedGroup = await group.save();

    // Notifier les admins
    const user = await User.findById(socket.userData._id).select("userPseudo");
    if (user) {
      const notificationPromises = group.admins.map(async (adminId) => {
        return await createNotification({
          recipient: adminId,
          sender: socket.userData._id,
          type: "system_notification",
          content: {
            title: "Nouvelle évaluation de groupe",
            message: `${user.userPseudo} a évalué le groupe "${group.name}" (${rating}/5)`,
            roomId: roomId,
          },
          relatedEntity: {
            entityType: "Room",
            entityId: roomId,
          },
          priority: "normal",
        });
      });

      const notifications = await Promise.all(notificationPromises);
      await sendNotificationToUsers(io, notifications, global.connectedUsers);
    }

    callback({
      success: true,
      message: "Évaluation enregistrée avec succès",
      averageRating: updatedGroup.averageRating,
    });
  } catch (error) {
    console.log("Erreur lors de l'évaluation:", error);
    callback({ error: "Erreur lors de l'évaluation du groupe", details: error.message });
  }
}

export async function handleRequestRoomRefund(socket, io, data, callback) {
  const session = await mongoose.startSession();

  try {
    const { roomId } = data;

    if (!roomId) {
      return callback({ error: "ID de la room manquant" });
    }

    if (!socket.userData?._id) {
      return callback({ error: "Utilisateur non authentifié" });
    }

    // Trouver le paiement correspondant
    const payment = await Payment.findOne({
      user: socket.userData._id,
      "relatedEntity.entityType": "room",
      "relatedEntity.entityId": roomId,
      type: "room_subscription",
      status: "completed",
    }).session(session);

    if (!payment) {
      return callback({ error: "Aucun paiement remboursable trouvé pour cette room" });
    }

    // Vérifier la période de remboursement
    if (payment.refundableBefore && new Date() > payment.refundableBefore) {
      return callback({ error: "La période de remboursement a expiré" });
    }

    const room = await Room.findById(roomId).session(session);
    if (!room) {
      return callback({ error: "Room non trouvée" });
    }

    const user = await User.findById(socket.userData._id).session(session).select("wallet");
    if (!user) {
      return callback({ error: "Utilisateur non trouvé" });
    }

    const creator = await User.findById(room.creator).session(session).select("wallet");
    if (!creator) {
      return callback({ error: "Propriétaire de la room non trouvé" });
    }

    // Traiter le remboursement
    user.wallet.balance += payment.amount;
    creator.wallet.balance -= payment.amount;
    room.wallet.balance -= payment.amount;

    // Créer l'enregistrement de remboursement
    const refund = new Payment({
      user: creator._id,
      recipient: socket.userData._id,
      amount: payment.amount,
      currency: payment.currency,
      type: "room_refund",
      status: "completed",
      paymentMethod: "platform-balance",
      relatedEntity: {
        entityType: "room",
        entityId: room._id,
      },
      originalPayment: payment._id,
    });

    await refund.save({ session });

    user.wallet.transactions.push(refund._id);
    creator.wallet.transactions.push(refund._id);

    payment.status = "refunded";
    payment.refundable = false;

    await payment.save({ session });
    await user.save({ session });
    await creator.save({ session });
    await room.save({ session });

    // Retirer l'utilisateur de la room
    room.members = room.members.filter(
      (memberId) => memberId.toString() !== socket.userData._id.toString()
    );
    await room.save({ session });

    socket.leave(roomId);

    // Notifications
    const leaveNotifications = room.members.map(async (memberId) =>
      await createNotification({
        recipient: memberId,
        type: "room_update",
        content: {
          title: "Membre parti",
          message: `${socket.userData.userName}(${socket.userData.KSD}) a quitté la room après remboursement`,
          roomId: room._id,
        },
      })
    );

    const refundNotifications = await Promise.all([
      createNotification({
        recipient: socket.userData._id,
        type: "refund_processed",
        content: {
          title: "Remboursement approuvé",
          message: `✅ Remboursement approuvé: Transaction #${refund._id} pour "${room.name}" remboursée (${room.price} coins). Vérifiez votre solde!`,
          roomId: room._id,
        },
      }),
      createNotification({
        recipient: room.creator,
        type: "refund_processed",
        content: {
          title: "Remboursement traité",
          message: `⚠️ Remboursement traité: ${room.price} coins ont été remboursés à @${socket.userData.userName}--KSD:${socket.userData.KSD} pour avoir quitté la room "${room.name}". ID Transaction: #${refund._id}. Contactez support@example.com pour questions.`,
          roomId: room._id,
        },
      }),
    ]);

    const allNotifications = await Promise.all(leaveNotifications);
    await sendNotificationToUsers(io, [...allNotifications, ...refundNotifications], global.connectedUsers);

    callback({
      success: true,
      message: "Remboursement traité avec succès",
      refund: {
        amount: payment.amount,
        transactionId: refund._id,
      },
    });
  } catch (error) {
    console.log("Erreur lors du remboursement:", error);
    callback({ error: "Erreur lors du remboursement", details: error.message });
  } finally {
    session.endSession();
  }
}