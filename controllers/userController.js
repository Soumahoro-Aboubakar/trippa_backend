import { postFile } from "../config/backblaze.js";
import User from "../models/user.model.js";
import { findNearbyUsers, updateUserLocation } from "../services/geoService.js";
import { storeMedia } from "../services/mediaService.js";
import { isUserOnline } from "../services/socketService.js";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import twilio from "twilio";
import { createNotification } from "../services/notificationService.js";
import { hashRefreshToken } from "../services/authService.js";
import { dataParse } from "../utils/validator.js";
import mongoose from "mongoose";

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}
const forbiddenKeys = [
  "$where",
  "$ne",
  "$gt",
  "$lt",
  "$in",
  "$nin",
  "$or",
  "$and",
  "$set",
  "$push",
];

const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN_TWILIO);
function generateCode() {
  return Math.floor(1000 + Math.random() * 9000); // exemple : 4721
}
dotenv.config();

const sendVerificationCode = async (toPhoneNumber, code) => {
  const message = `Votre code de vérification est : ${code}`;
  console.log(
    process.env.MESSAGE_SERVICE_SID,
    " messagingServiceSid ",
    toPhoneNumber,
    " toPhoneNumber ",
    message,
    " message "
  );

  try {
    const sms = await client.messages.create({
      body: message,
      to: toPhoneNumber,
      messagingServiceSid: process.env.MESSAGE_SERVICE_SID, //
      from: "",
    });
    return code;
  } catch (error) {
    console.error("❌ Erreur lors de l'envoi du SMS :", error.message);
    throw error;
  }
};

const generateUniqueKSD = async () => {
  let isUnique = false;
  let ksd = "";

  while (!isUnique) {
    // Générer un KSD aléatoire entre 3 et 5 caractères
    const length = Math.floor(Math.random() * 3) + 3; // 3, 4, ou 5
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    ksd = "";

    for (let i = 0; i < length; i++) {
      ksd += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    // Vérifier que ce KSD n'existe pas déjà
    const existingUser = await User.findOne({ KSD: ksd });
    if (!existingUser) {
      isUnique = true;
    }
  }

  return ksd;
};
export const generateRefreshToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.REFRESH_TOKEN_EXPIRATION,
  });
};
export const generateToken = (userId) => {
  console.log("user id pour en encoder le token  ", userId);
  return jwt.sign({ userId: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.TOKEN_EXPIRATION,
  });
};

/*
export const createUser = async (socket, userData) => {
  try {
    const { phone, countryCode, currentUserPublicKey } = userData; //exemple countryCode : CI pour la cote d'ivoire, SN pour le sénégal,

    if (!phone || typeof phone !== "string") {
      socket.emit("user:error", {
        message: "Le numéro de téléphone est requis et doit être valide.",
      });
      return;
    } //currentUserPublicKey
    if (
      !countryCode ||
      typeof countryCode !== "string" ||
      countryCode.length < 2
    ) {
      socket.emit("user:error", {
        message: "Le country code est requis et doit être valide.",
      });
      return;
    }
    if (!currentUserPublicKey || typeof currentUserPublicKey !== "string") {
      socket.emit("user:error", {
        message:
          "La clé publique de l'utilisateur est requis et doit être valide.",
      });
      return;
    }
    const trimmedPhone = phone.trim();
    const code = generateCode();
    const now = new Date();

    let user = await User.findOne({ phone: trimmedPhone });

    if (user) {
      user.verifyCode = {
        code,
        createdAt: now,
      };
    } else {
      const ksdGenerate = await generateUniqueKSD();
      const KSD = `${countryCode?.toUpperCase()}-${ksdGenerate}`;

      user = new User({
        phone: trimmedPhone,
        countryCode: countryCode?.toUpperCase(),
        KSD,
        userKeys: {
          lastUserPublicKey: user?.userKeys?.currentUserPublicKey || "",
          currentUserPublicKey: currentUserPublicKey, // Clé publique de l'utilisateur pour le chiffrement des messages
        },
        verifyCode: {
          code,
          createdAt: now,
        },
      });
    }

    await user.save();
    //await sendVerificationCode(trimmedPhone, code);
    console.log(
      user?.verifyCode?.code,
      "   le code de validation est donné par ici"
    );

    // 📤 7. Réponse au client
    socket.emit("verification:sent", {
      message:
        "Un code de vérification a été envoyé à votre numéro de téléphone.",
    });
  } catch (error) {
    console.error("❌ Erreur lors de la création de l'utilisateur :", error);
    socket.emit("user:error", {
      message:
        "Une erreur est survenue lors de la création de l'utilisateur. Veuillez réessayer.",
    });
  }
}; */

export const createUser = async (socket, userData) => {
  try {
    const { phone, countryCode, currentUserPublicKey } = userData;

    // ✅ Vérifications basiques
    if (!phone || typeof phone !== "string") {
      socket.emit("user:error", {
        message: "Le numéro de téléphone est requis et doit être valide.",
      });
      return;
    }

    if (!countryCode || typeof countryCode !== "string" || countryCode.length < 2) {
      socket.emit("user:error", {
        message: "Le country code est requis et doit être valide.",
      });
      return;
    }

    if (!currentUserPublicKey || typeof currentUserPublicKey !== "string") {
      socket.emit("user:error", {
        message: "La clé publique de l'utilisateur est requise et doit être valide.",
      });
      return;
    }

    // ✅ Normalisation
    const trimmedPhone = phone.trim();
    const code = generateCode();
    const now = new Date();

    // ✅ Génération KSD seulement en cas de création
    const ksdGenerate = await generateUniqueKSD();
    const KSD = `${countryCode?.toUpperCase()}-${ksdGenerate}`;

    // ✅ Mise à jour si existe, sinon création
    const user = await User.findOneAndUpdate(
      { phone: trimmedPhone }, // filtre
      {
        $set: {
          countryCode: countryCode.toUpperCase(),
          "userKeys.currentUserPublicKey": currentUserPublicKey,
          verifyCode: { code, createdAt: now },
        },
        $setOnInsert: {
          phone: trimmedPhone,
          KSD,
          "userKeys.lastUserPublicKey": "",
          createdAt: now,
        },
      },
      { new: true, upsert: true } // new = retourne le doc modifié, upsert = insert si absent
    );

    console.log(user?.verifyCode?.code, "   ✅ code de validation généré");

    //await sendVerificationCode(trimmedPhone, code);

    socket.emit("verification:sent", {
      message: "Un code de vérification a été envoyé à votre numéro de téléphone.",
    });
  } catch (error) {
    console.error("❌ Erreur lors de la création de l'utilisateur :", error);
    socket.emit("user:error", {
      message: "Une erreur est survenue lors de la création de l'utilisateur. Veuillez réessayer.",
    });
  }
};


// === Fonctions utilitaires ===

const sendVerificationError = (socket, payload) => {
  socket.emit("verification:error", payload);
};

const isAccountBlocked = (user) => {
  const maxAge = 24 * 60 * 60 * 1000; // 24 heures
  const lastAttempt = user.loginAttempts.lastAttemptDate;

  return (
    user.loginAttempts.current >= user.loginAttempts.maxAllowed &&
    lastAttempt &&
    new Date() - lastAttempt < maxAge
  );
};

const isCodeExpired = (user) => {
  const expirationTime = 2 * 60 * 1000; // 2 minutes
  return new Date() - user.verifyCode.createdAt > expirationTime;
};

const handleFailedAttempt = async (socket, user) => {
  user.loginAttempts.current += 1;
  user.loginAttempts.lastAttemptDate = new Date();
  await user.save();

  const attemptsLeft =
    user.loginAttempts.maxAllowed - user.loginAttempts.current;

  if (user.loginAttempts.current >= user.loginAttempts.maxAllowed) {
    sendVerificationError(socket, {
      code: 400,
      status: "blocked",
      message:
        "Votre compte a été bloqué pour 24 heures en raison d’un trop grand nombre de tentatives de connexion. Veuillez réessayer après ce délai.",
    });
  } else {
    sendVerificationError(socket, {
      code: 401,
      attemptsLeft,
      message: `Le code de vérification est incorrect. Veuillez réessayer. Il vous reste ${attemptsLeft} tentative(s).`,
    });
  }
};

const resetLoginAttempts = (user) => {
  user.loginAttempts.current = 0;
  user.loginAttempts.lastAttemptDate = null;
};

export const verifyUserSMS = async (
  socket,
  code,
  deviceId,
  phoneNumber,
  phoneHash
) => {
  try {
    const phoneRegex = /^\+\d{7,15}(?:\s?\d+)*$/;
    if (
      !phoneNumber ||
      typeof phoneNumber !== "string" ||
      !phoneRegex.test(phoneNumber.replace(/\s+/g, ""))
    ) {
      sendVerificationError(socket, {
        message: "Numéro de téléphone invalide",
      });
      return;
    }
    if (!phoneHash || typeof phoneHash !== "string") {
      sendVerificationError(socket, {
        message:
          "Le hash du numéro de téléphone est requis et doit être valide.",
      });
      return;
    }
    if (!code || typeof code !== "string" || !/^[0-9]{4,6}$/.test(code)) {
      sendVerificationError(socket, {
        message: "Code de vérification invalide",
      });
      return;
    }
    if (!phoneNumber || !code) {
      sendVerificationError(socket, { message: "Session expirée" });
      return;
    }

    const user = await User.findOne({ phone: phoneNumber });

    if (!user) {
      sendVerificationError(socket, {
        code: 404,
        message: "Utilisateur non trouvé",
      });
      return;
    }


    // Vérification du blocage temporaire
    if (isAccountBlocked(user)) {
      sendVerificationError(socket, {
        code: 403,
        status: "blocked",
        message:
          "Votre compte a été bloqué pour 24 heures en raison d’un trop grand nombre de tentatives de connexion. Veuillez réessayer après ce délai.",
      });
      return;
    }


    // Vérification du code SMS
    if (user.verifyCode?.code !== code) {
      handleFailedAttempt(socket, user);
      return;
    }

    // Vérification expiration du code
    if (isCodeExpired(user)) {
      sendVerificationError(socket, {
        code: 402,
        message: "Le code de vérification a expiré",
      });
      return;
    }

    // Réinitialisation des tentatives
    resetLoginAttempts(user);

    // Génération des tokens
    const token = generateToken(user._id.toString());
    const refreshToken = generateRefreshToken(user._id.toString());
    const tokenHacher = await hashRefreshToken(refreshToken);
    user.refreshTokens.push({ deviceId, token: tokenHacher });
    const isNewMember = user.isNewMember;
    user.isNewMember = false;
    user.phoneHash = phoneHash;
    console.log(
      " le refresh token non crypté : ",
      refreshToken,
      " et le token ",
      token
    );
    console.log(
      " voici les information sur l'appareil de user ",
      deviceId,
      " et autre token hach ",
      tokenHacher
    );

    console.log("  voici le log du user créer  :  ", user);
    const filterData = userDataToSelect(user._id, user._id);

    await user.save();
    const filteredUser = await User.findById(user._id).select(filterData);

    socket.emit("user:created", {
      message: "Votre compte a été créé avec succès",
      code: 200,
      token,
      refreshToken,
      user: filteredUser,
      isNewMember: isNewMember,
    });
  } catch (error) {
    console.error("Erreur lors de la vérification SMS:", error);
    sendVerificationError(socket, {
      message: "Une erreur est survenue lors de la vérification",
    });
  }
};

export const resendSmsVerificationCode = async (socket, phone) => {
  try {
    if (!phone || typeof phone !== "string") {
      socket.emit("verification:error", {
        code: 401,
        message: "Le numéro de téléphone est requis et doit être valide.",
      });
      return;
    }

    const trimmedPhone = phone.trim();
    const user = await User.findOne({ phone: trimmedPhone });

    if (!user) {
      socket.emit("verification:error", {
        code: 403,
        message:
          "Utilisateur non trouvé, veuillez vérifier votre numéro de téléphone. Si le numéro est correct, veuillez contacter nous laisser un message.",
      });
      return;
    }

    const code = generateCode();
    const now = new Date();

    user.verifyCode = {
      code,
      createdAt: now,
    };
    await user.save();

    await sendVerificationCode(user.phone, code);

    socket.emit("verification:sent", {
      message:
        "Un nouveau code de vérification a été envoyé à votre numéro de téléphone.",
    });
  } catch (error) {
    console.error("Erreur lors de la réinitialisation du code SMS:", error);
    socket.emit("verification:error", {
      message: "Une erreur est survenue lors de la réinitialisation du code",
    });
  }
};

// Obtenir le profil utilisateur
export const getUserProfile = async (socket, userId) => {
  try {
    if (!isValidObjectId(userId)) {
      socket.emit("user:profile_error", {
        status: 400,
        message: "ID utilisateur invalide",
      });
      return;
    }
    const filterData = userDataToSelect(userId, socket.userData?._id);

    const user = await User.findById(userId).select(filterData);

    if (!user) {
      socket.emit("user:profile_error", {
        status: 404,
        message: "Utilisateur non trouvé",
      });
      return;
    }

    // Récupération de l'ID du visiteur depuis les données d'authentification
    const viewerId = socket.userData?._id;

    // Mise à jour des viewers seulement si c'est un visiteur différent
    if (viewerId && viewerId !== userId?.toString()) {
      const updateOperation = {
        $push: {
          "profile.profileViewers": {
            userId: viewerId,
            viewedAt: new Date(),
          },
        },
      };

      await User.updateOne({ _id: userId }, updateOperation, { new: true });
    }

    // Préparation de la réponse avec statut en ligne
    const userResponse = user.toObject();
    userResponse.isOnline = isUserOnline(user._id);

    socket.emit("user:profile", { user: userResponse, code: 200 });
  } catch (error) {
    console.error(
      "Erreur lors de la récupération du profil utilisateur:",
      error
    );
    socket.emit("user:profile_error", {
      status: 500,
      message: "Erreur serveur",
    });
  }
};

export const updateUserProfile = async (socket, updateData) => {
  try {
    if (!updateData) {
      socket.emit("profile:update_error", {
        status: 404,
        message: "Données non trouvées",
      });
      return;
    }
    for (const key in updateData) {
      if (forbiddenKeys.includes(key)) {
        socket.emit("profile:update_error", {
          status: 400,
          message: "Clé de mise à jour non autorisée.",
        });
        return;
      }
    }
    const userId = updateData._id;
    let coinsToEarn = 10;
    let inviter = null;
    // Construction dynamique du payload
    const updatePayload = {};
    if ("bio" in updateData) updatePayload["profile.bio"] = updateData.bio;
    if ("interests" in updateData)
      updatePayload["profile.interests"] = updateData.interests;
    if ("isShyMode" in updateData)
      updatePayload["profile.isShyMode"] = updateData.isShyMode;
    if ("visibility" in updateData)
      updatePayload["profile.visibility"] = updateData.visibility;
    if ("userPseudo" in updateData)
      updatePayload["userPseudo"] = updateData.userPseudo;
    if ("photo" in updateData)
      updatePayload["profile.photo"] = updateData.photo;

    // Mise à jour atomique
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updatePayload },
      {
        new: true,
        runValidators: true,
        projection: { profile: 1, points: 1, KSD: 1, userPseudo: 1 },
      }
    );

    if (!updatedUser) {
      socket.emit("profile:update_error", {
        status: 404,
        message: "Utilisateur non trouvé",
      });
      return;
    }

    // Gestion du bonus d'invitation
    let inviterId = null;
    if (updateData.InviterKSD) {
      inviter = await User.findOne({
        KSD: updateData.InviterKSD?.toUpperCase(),
      });
      if (inviter && inviter._id.toString() !== userId.toString()) {
        inviterId = inviter._id;
        await User.findByIdAndUpdate(inviterId, {
          $inc: { points: coinsToEarn },
        });
        await User.findByIdAndUpdate(userId, {
          $inc: { points: Math.floor(coinsToEarn / 2) },
        });
      }
    }

    socket.emit("profile:updated", {
      message: "Votre profile a été mmise à jours avec succès",
      code: 200,
      profile: updatedUser.profile,
    });

    // Notification à l'inviteur si besoin
    if (inviterId) {
      const notification = await createNotification({
        recipient: inviterId,
        type: "system_notification",
        content: {
          message: `Vous avez reçu un bonus de ${coinsToEarn} points pour l'invitation de ${updatedUser.userPseudo}, KSD:${updatedUser.KSD}`,
        },
        coinsEarned: coinsToEarn,
      });
      if (global.connectedUsers?.has(inviterId)) {
        const receiverSocketsId = global.connectedUsers.get(inviterId);
        const receiverSocket = io.sockets.sockets.get(receiverSocketsId);
        receiverSocket
          ?.to(receiverSocketsId)
          .emit("notification", { notification, code: 200 });
      }
    }
  } catch (error) {
    console.error("Erreur mise à jour profil:", error);

    const errorMessage =
      error.name === "ValidationError"
        ? "Données de profil invalides"
        : "Erreur serveur";

    socket.emit("profile:update_error", {
      status: error.statusCode || 500,
      message: errorMessage,
      details: error.errors,
    });
  }
};

export const userDataToSelect = (userId1, userId2) => {
  const pairValue =
    "-refreshTokens -userKeys  -userBanned -loginAttempts -verifyCode";
  if (userId1 === userId2) return pairValue;
  return (
    "-wallet  -location -lastLocation -profile.profileViewers -profile.statusViewers -statusShared " +
    pairValue
  );
};

export async function handleGetUserByKSD(socket, data, callback) {
  const { KSD, userId } = data || {};

  console.log(
    "voici ce que le log nous donne pour voir que la voir fonctionne ksd  ",
    KSD,
    " et les uatres info ",
    userId
  );
  try {
    if (!KSD) {
      return callback({ error: "KSD manquant" });
    }
    const filterData = userDataToSelect(userId, socket.userData?._id);

    const user = await User.findOne({ KSD }).select(
      `${filterData} -refreshTokens -userKeys`
    );
    if (!user) {
      console.log(
        "erreur lors de de la recherche de l'utilissateur  Utilisateur non trouvé "
      );
      return callback({ error: "Utilisateur non trouvé" });
    }
    callback({ user });
  } catch (err) {
    console.log("voici l'erreur professionnel : ", err);
    callback({ error: "Erreur serveur", details: err.message });
  }
}

// Trouver des utilisateurs à proximité (version Socket.io)
export const getNearbyUsers = async (socket, data) => {
  try {
    const { radius = 1000 } = data;

    // Récupérer l'utilisateur connecté depuis les informations du socket
    const currentUser = await User.findById(socket.userData._id);
    if (!currentUser?.location?.coordinates) {
      socket.emit("nearby-users:error", {
        message: "Position de l'utilisateur non disponible",
      });
      return;
    }

    // Recherche des utilisateurs proches
    const nearbyUsers = await findNearbyUsers(
      currentUser.location.coordinates,
      Number(radius),
      socket.userData._id
    );

    // Filtrage selon la visibilité
    const filteredUsers = nearbyUsers.filter(
      (user) => user.profile?.visibility === "public"
    );

    // Ajout du statut en ligne
    const usersWithStatus = filteredUsers.map((user) => ({
      ...user.toObject(),
      isOnline: isUserOnline(user._id),
    }));

    socket.emit("nearby-users:result", {
      users: usersWithStatus,
      code: 200,
    });
  } catch (error) {
    console.error("Erreur récupération utilisateurs proches:", error);
    socket.emit("nearby-users:error", { message: "Erreur serveur" });
  }
};

export const handleSyncContacts = async (socket, data, callback) => {
console.log("voici le log de tous les contacts  ", data);
  try {
    if (!socket.userData?._id) {
      return callback({
        error: "Utilisateur non authentifié",
        code: "AUTH_REQUIRED",
        success: false,
      });
    }

    const parsedData = dataParse(data);
    const { contactsHach } = parsedData;
    const userId = socket.userData._id;

    if (
      !contactsHach ||
      !Array.isArray(contactsHach) ||
      contactsHach.length === 0
    ) {
      return callback({
        success: false,

        message: "Données de contacts invalides",
        code: "INVALID_CONTACTS_DATA",
      });
    }

    const validContactHashes = contactsHach
      .filter((hash) => typeof hash === "string" && hash.length > 0)
      .map((hash) => hash.trim());

    if (validContactHashes.length === 0) {
      return callback({
        success: false,
        message: "Aucun hash de contact valide fourni",
        code: "NO_VALID_CONTACTS",
      });
    }

    const filterData = userDataToSelect(userId, "randomUserId");
    const appUsers = await User.find(
      {
        phoneHash: { $in: validContactHashes },
        _id: { $ne: new mongoose.Types.ObjectId(userId)}, // Exclure l'utilisateur actuel
      },
      filterData
    ).lean(); // Utiliser lean() pour de meilleures performances

    const foundPhoneHashes = new Set(appUsers.map((user) => user.phoneHash));
    const nonAppUsersHashes = validContactHashes.filter(
      (hash) => !foundPhoneHashes.has(hash)
    );

    return callback({
      success: true,
      message: "Contacts synchronisés avec succès",
      data: {
        appUsers: appUsers,
        nonAppUsersCount: nonAppUsersHashes.length,
        totalContactsProcessed: validContactHashes.length,
        appUsersCount: appUsers.length,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Erreur lors de la synchronisation des contacts:", error);
    callback({
      success: false,
      message: "Erreur de serveur lors de la synchronisation des contacts",
    });
  }
};

// Mettre à jour la position (version Socket.io)
export const updateLocation = async (socket, data) => {
  try {
    const { coordinates, address } = data;
    // Validation des coordonnées
    if (
      !coordinates ||
      !Array.isArray(coordinates) ||
      coordinates.length !== 2
    ) {
      socket.emit("location:error", {
        message: "Coordonnées invalides",
      });
      return;
    }

    // Mise à jour en base
    const updatedUser = await updateUserLocation(
      socket.userData._id,
      coordinates,
      address
    );

    // Envoi de la confirmation
    socket.emit("location:updated", {
      location: updatedUser.location,
      lastLocation: updatedUser.lastLocation,
    });
  } catch (error) {
    console.error("Erreur mise à jour localisation:", error);
    socket.emit("location:error", { message: "Erreur serveur" });
  }
};

export async function joinUserRooms(socket) {
  const userId = socket?.userData?._id;
  if (!userId) {
    console.warn("Impossible de rejoindre les rooms : utilisateur non authentifié.");
    return;
  }

  try {
    const user = await User.findById(userId).select("rooms").lean();
    if (!user || !Array.isArray(user.rooms)) {
      console.warn(`Aucune room trouvée pour l'utilisateur ${userId}`);
      return;
    }

    user.rooms.forEach((roomId) => {
      if (roomId) {
        socket.join(roomId.toString());
      }
    });

    console.log(`🔗 L'utilisateur ${userId} a rejoint ${user.rooms.length} room(s).`);
  } catch (err) {
    console.error("❌ Erreur lors de la jonction aux rooms :", err);
  }
}
