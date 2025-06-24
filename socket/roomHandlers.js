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

export function setupRoomSocket(io, socket) {
  socket.on("get_rooms_by_search", (data, callback) => {
    advandedRoomSearch(data, callback);
  });

  socket.on("get_room_by_acces_code", (data, callback) => {
    getRommByAccessCode(
      {
        ...dataParse(data),
        userId: socket.userData?._id,
      },
      callback
    );
  });
/////////////////deux_parties
  // Enhanced room creation with payment and privacy settings
  socket.on("create:room", async (roomData) => {
    try {
      // Extract and validate payment and privacy settings
      const {
        isPaid = false,
        isPrivate = false,
        price = 0,
        accessCode = null,
        refundPeriodDays = 0, // Default no refund
        members = [],
        ...otherRoomData
      } = roomData;

      // Validate paid room data
      if (isPaid && (!price || price <= 0)) {
        throw new Error("Paid rooms must have a valid price greater than 0");
      }

      // Validate private room data
      if (isPrivate && !accessCode) {
        throw new Error("Private rooms must have an access code");
      }

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

      socket.join(savedRoom._id.toString());

      // Notify the creator
      socket.emit("room:created:success", savedRoom);
    } catch (error) {
      console.log(error, " this the errors");
      socket.emit("room:created:error", error.message);
    }
  });

  // Join a room (with payment and access code handling)
  socket.on("join:room", async ({ roomId, accessCode, paymentMethod }) => {
    const session = await mongoose.startSession();
    // session.startTransaction();
    try {
      // Find the room
      const room = await Room.findById(roomId).session(session);
      if (!room) {
        throw new Error("Room not found");
      }

      // Check if user is already a member
      if (room.members.includes(socket.userData._id)) {
        throw new Error("You are already a member of this room");
      }

      // Check access code for private rooms
      if (room.isPrivate && room.accessCode !== accessCode) {
        throw new Error("Invalid access code");
      }

      // Handle payment for paid rooms
      if (room.isPaid) {
        // Verify user has sufficient balance
        const user = await User.findById(socket.userData._id)
          .session(session)
          .select("wallet");

        if (!user || user.wallet.balance < room.price) {
          throw new Error("Insufficient balance to join this paid room");
        }

        // Create payment record
        const payment = new Payment({
          user: socket.userData._id,
          recipient: room.creator, // Room creator receives the payment
          amount: room.price,
          currency: "coins", // Assuming virtual currency
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

        // Deduct from user's balance
        user.wallet.balance -= room.price;
        user.wallet.transactions.push(payment._id);
        await user.save({ session });

        // Add to room creator's balance
        const creator = await User.findById(room.creator)
          .session(session)
          .select("wallet");

        if (creator) {
          creator.wallet.balance += room.price;
          creator.wallet.transactions.push(payment._id);
          await creator.save({ session });
        }

        // Add to room's wallet for tracking
        room.wallet.balance += room.price;
        room.wallet.transactions.push(payment._id);
      }

      // Add user to room members
      room.members.push(socket.userData._id);
      const updatedRoom = await room.save({ session });

      // Commit transaction
      // await session.commitTransaction();

      // Join socket room
      socket.join(roomId);

      // Populate members data for response
      await updatedRoom.populate("members", "username profile KSD");

      // Notify user of successful join
      socket.emit("room:joined:success", updatedRoom);

      // Notify other room members
      socket.to(roomId).emit("member:joined", {
        //
        roomId,
        user: {
          _id: socket.userData._id,
          username: socket.userData.userName,
          KSD: socket.userData.KSD,
        },
      });

      //Send notifacation all users
      // Créer les notifications en parallèle
      const notificationPromises = room.members.map(
        async (memberId) =>
          await createNotification({
            recipient: memberId,
            type: "room_update",
            content: {
              title: "New Member Joined",
              message: `${socket.userData.userName} has joined the room "${room.name}"`,
              roomId: room._id,
            },
          })
      );

      // Attendre que toutes les notifications soient créées
      const notifications = await Promise.all(notificationPromises);

      // Envoyer toutes les notifications en une seule fois
      const user = await User.findById(socket.userData._id).session(session);
      user.rooms.push(roomId); //Ajouter la room au tableau des rooms de l'utilisateur afin de l'ajouter a la room lors de la connection en utilisant les sockets
      user.save({ session });
      await sendNotificationToUsers(io, notifications, global.connectedUsers);
      // Send notification to user
      if (room.isPaid) {
        let notif = await createNotification({
          recipient: socket.userData._id,
          type: "payment_update",
          content: {
            title: "Room Access Purchased",
            message: `You have successfully joined the paid room "${room.name}" for ${room.price} coins.`,
            roomId: room._id,
          },
        });
        await sendNotificationToUsers(io, [notif], global.connectedUsers);
      }
    } catch (error) {
      // Rollback transaction
      // await session.abortTransaction();
      socket.emit("room:joined:error", {
        code: error.message.includes("Insufficient balance")
          ? "INSUFFICIENT_BALANCE"
          : error.message.includes("Invalid access code")
          ? "INVALID_ACCESS_CODE"
          : "JOIN_FAILURE",
        message: error.message,
      });
    } finally {
      session.endSession();
    }
  });

  // Request refund for a paid room (if within refund period)
  socket.on("request:room:refund", async ({ roomId }) => {
    const session = await mongoose.startSession();

    try {
      // Find relevant payment
      const payment = await Payment.findOne({
        user: socket.userData._id,
        "relatedEntity.entityType": "room",
        "relatedEntity.entityId": roomId,
        type: "room_subscription",
        status: "completed",
      }).session(session);

      if (!payment) {
        throw new Error("No refundable payment found for this room ", payment);
      }
      // Check if within refund period
      if (payment.refundableBefore && new Date() > payment.refundableBefore) {
        throw new Error("Refund period has expired");
      }

      // Find the room
      const room = await Room.findById(roomId).session(session);
      if (!room) {
        throw new Error("Room not found");
      }

      // Find the user
      const user = await User.findById(socket.userData._id)
        .session(session)
        .select("wallet");

      if (!user) {
        throw new Error("User not found");
      }

      // Find the room creator
      const creator = await User.findById(room.creator)
        .session(session)
        .select("wallet");

      if (!creator) {
        throw new Error("Room owner not found");
      }

      // Process refund
      // 1. Return money to user
      user.wallet.balance += payment.amount;

      // 2. Deduct from creator
      creator.wallet.balance -= payment.amount;

      // 3. Update room wallet
      room.wallet.balance -= payment.amount;

      // 4. Create refund record
      const refund = new Payment({
        user: creator._id,
        recipient: socket.userData._id,
        amount: payment.amount,
        currency: payment.currency,
        type: "room_refund",
        status: "completed",
        paymentMethod: "platform-balance",
        relatedEntity: {
          type: "room",
          id: room._id,
        },
        originalPayment: payment._id,
      });

      await refund.save({ session });

      // Add transaction to both users' wallets
      user.wallet.transactions.push(refund._id);
      creator.wallet.transactions.push(refund._id);

      // Mark original payment as refunded
      payment.status = "refunded";
      payment.refundable = false;

      // Save all changes
      await payment.save({ session });
      await user.save({ session });
      await creator.save({ session });
      await room.save({ session });

      // Remove user from room members
      room.members = room.members.filter(
        (memberId) => memberId.toString() !== socket.userData._id.toString()
      );
      await room.save({ session });

      // Commit transaction
      //  await session.commitTransaction();

      // Leave socket room
      socket.leave(roomId);
      const notificationLeave = [
        ...room.members,
        socket.userData._id.toString(),
      ].map(
        async (memberId) =>
          await createNotification({
            recipient: memberId,
            type: "room_update",
            content: {
              title: "Group Leave",
              message: `${socket.userData.userName}(${socket.userData.KSD}) has left the room`,
              roomId: room._id,
            },
          })
      );
      // Attendre que toutes les notifications soient créées
      const notifications = await Promise.all(notificationLeave);
      await sendNotificationToUsers(io, notifications, global.connectedUsers);

      /// Création des 2 notifications en parallèle
      const refundNotifications = await Promise.all([
        createNotification({
          recipient: socket.userData._id,
          type: "refund_processed",
          content: {
            title: "Room Access Purchased",
            message: `✅ Refund Approved: Transaction #${refund._id} for "${room.name}" refunded (${room.price} coins). Check your balance updates!`,
            roomId: room._id,
          },
        }),
        createNotification({
          recipient: room.creator,
          type: "refund_processed",
          content: {
            title: "Room Access Purchased",
            message: `⚠️ Refund Processed: ${room.price} coins have been refunded to @${socket.userData.userName}--KSD:${socket.userData.KSD} for leaving the room "${room.name}". Transaction ID: #${refund._id}. Contact support@example.com for questions.`,
            roomId: room._id,
          },
        }),
      ]);
      await sendNotificationToUsers(
        io,
        refundNotifications,
        global.connectedUsers
      );
    } catch (error) {
      // Rollback transaction
      //   await session.abortTransaction();

      socket.emit("room:refund:error", {
        message: error.message,
      });
    } finally {
      session.endSession();
    }
  });

  // Mise à jour des informations de la room
  socket.on("update:room", async ({ roomId, updates }) => {
    try {
      const room = await Room.findById(roomId);
      if (!room) {
        socket.emit("room:updated:error", "Update failed or no changes made");
        return;
      }

      if (!room.admins.includes(socket.userData._id)) {
        throw new Error("Unauthorized: Only admins can update the room");
      }
      const updatedRoom = await Room.findByIdAndUpdate(
        roomId,
        { $set: updates },
        { new: true }
      ).populate("members", "username profile");
      updatedRoom.members = room.members; // Ensure members are not modified
      updatedRoom.price =
        socket.userData._id === room.creator ? updatedRoom.price : room.price; // Ensure price is not modified, only the creator can change it

      // Confirmation à l'émetteur
      socket.emit("room:updated:success", updatedRoom);

      // Diffusion à la room
      io.to(roomId).emit("room:updated", updatedRoom); //ici on prends la notification et on met tous à jour
    } catch (error) {
      socket.emit("room:updated:error", error.message);
    }
  });

  // Gestion de l'option "quitter une room"
  socket.on("leave:room", async ({ roomId }) => {
    const session = await mongoose.startSession();

    try {
      // Vérifier si la room existe
      const room = await Room.findById(roomId).session(session);
      if (!room) {
        throw new Error("Room introuvable");
      }

      // Vérifier si l'utilisateur est membre de la room
      if (
        !room.members.some(
          (member) => member.toString() === socket.userData._id.toString()
        )
      ) {
        throw new Error("Vous n'êtes pas membre de cette room");
      }

      // Vérifier si l'utilisateur est le seul admin
      const isAdmin = room.admins.some(
        (admin) => admin.toString() === socket.userData._id.toString()
      );
      const isOnlyAdmin = isAdmin && room.admins.length === 1;

      // Si c'est le seul admin et qu'il reste d'autres membres, on doit désigner un nouvel admin
      if (isOnlyAdmin && room.members.length > 1) {
        // Trouver un autre membre qui n'est pas admin
        const otherMembers = room.members.filter(
          (member) => member.toString() !== socket.userData._id.toString()
        );

        if (otherMembers.length > 0) {
          // Désigner le premier membre comme nouvel admin
          room.admins = [otherMembers[0]];
          // Notifier l'utilisateur
          socket.emit("room:left:success", {
            roomId,
            message: "Vous avez quitté la room avec succès",
          });
          // Créer une notification pour le nouvel admin
          let adminNotification = await createNotification({
            recipient: otherMembers[0],
            type: "room_update",
            content: {
              title: "Nouveau rôle administrateur",
              message: `Vous êtes désormais administrateur de la room "${room.name}"`,
              roomId: room._id,
            },
          });
          await sendNotificationToUsers(
            io,
            [adminNotification],
            global.connectedUsers
          );
        }
      }
      // Si c'est le dernier membre, on supprime la room
      else if (room.members.length === 1) {
        room.wallet.balance <= 0 &&
          (await Room.findByIdAndDelete(roomId).session(session));
        // Quitter la room socket
        socket.leave(roomId);
        return;
      }
      // Sinon, si c'est un admin (mais pas le seul), on le retire des admins
      else if (isAdmin) {
        // Retirer l'utilisateur des admins
        room.admins = room.admins.filter(
          (admin) => admin.toString() !== socket.userData._id.toString()
        );
      }

      // Retirer l'utilisateur des membres
      room.members = room.members.filter(
        (member) => member.toString() !== socket.userData._id.toString()
      );

      // Sauvegarder les modifications
      await room.save({ session });

      // Quitter la room socket
      socket.leave(roomId);

      // Notifier l'utilisateur
      socket.emit("room:left:success", {
        roomId,
        message: "Vous avez quitté la room avec succès",
      });

      const notificationPromises = room.members.map(
        async (memberId) =>
          await createNotification({
            recipient: memberId,
            type: "room_update",
            content: {
              title: "Member Left",
              message: `${socket.userData.userName}--(KSD:${socket.userData.KSD}) has left the room "${room.name}"`,
              roomId: room._id,
            },
          })
      );

      // Attendre que toutes les notifications soient créées
      const notifications = await Promise.all(notificationPromises);
      await sendNotificationToUsers(io, notifications, global.connectedUsers);
    } catch (error) {
      console.log(error);
      socket.emit("room:left:error", {
        message: error.message,
      });
    } finally {
      session.endSession();
    }
  });

  // Fonction pour expulser un membre (réservé aux admins)
  socket.on("kick:member", async ({ roomId, userId }) => {
    const session = await mongoose.startSession();

    try {
      // Vérifier si la room existe
      const room = await Room.findById(roomId).session(session);
      if (!room) {
        throw new Error("Room introuvable");
      }

      // Vérifier si l'utilisateur est admin
      if (
        !room.admins.some(
          (admin) => admin.toString() === socket.userData._id.toString()
        )
      ) {
        throw new Error(
          "Seuls les administrateurs peuvent expulser des membres"
        );
      }

      // Vérifier si le membre à expulser existe
      if (!room.members.some((member) => member.toString() === userId)) {
        throw new Error("Cet utilisateur n'est pas membre de la room");
      }

      // Vérifier qu'un admin n'essaie pas d'expulser un autre admin
      if (room.admins.some((admin) => admin.toString() === userId)) {
        throw new Error("Impossible d'expulser un administrateur");
      }

      // Retirer l'utilisateur des membres
      room.members = room.members.filter(
        (member) => member.toString() !== userId
      );

      // Sauvegarder les modifications
      await room.save({ session });

      // Commit de la transaction
      const notificationPromises = room.members.map(
        async (memberId) =>
          await createNotification({
            recipient: memberId,
            type: "room_update",
            content: {
              title: "Member Kicked",
              message: `${socket.userData.userName}--(KSD:${socket.userData.KSD})  has kicked from  the room "${room.name}"`,
              roomId: room._id,
            },
          })
      );

      // Attendre que toutes les notifications soient créées
      const notifications = await Promise.all(notificationPromises);

      // Envoyer toutes les notifications en une seule fois

      await sendNotificationToUsers(io, notifications, global.connectedUsers);

      let userKickedNotification = await createNotification({
        recipient: userId,
        type: "room_update",
        content: {
          title: "member kicked",
          message: `Vous avez été expulsé de la room "${room.name}"`,
          roomId: room._id,
        },
      });

      await sendNotificationToUsers(
        io,
        [userKickedNotification],
        global.connectedUsers
      );
      session.endSession();
    } catch (error) {
      socket.emit("member:kicked:error", {
        message: error.message,
      });
    } finally {
      session.endSession();
    }
  });

  // Fonction pour bannir un membre (réservé aux admins)
  socket.on("ban:member", async ({ roomId, userId, reason }) => {
    const session = await mongoose.startSession();

    try {
      // Vérifier si la room existe
      const room = await Room.findById(roomId).session(session);
      if (!room) {
        throw new Error("Room introuvable");
      }
      // Vérifier si l'utilisateur est admin
      if (
        !room.admins.some(
          (admin) => admin.toString() === socket.userData._id.toString()
        )
      ) {
        throw new Error("Seuls les administrateurs peuvent bannir des membres");
      }

      // Vérifier si le membre à bannir existe
      const isMember = room.members.some(
        (member) => member.toString() === userId
      );

      // Vérifier qu'un admin n'essaie pas de bannir un autre admin
      if (room.admins.some((admin) => admin.toString() === userId)) {
        throw new Error("Impossible de bannir un administrateur");
      }

      // Si l'utilisateur est un membre, le retirer
      if (isMember) {
        room.members = room.members.filter(
          (member) => member.toString() !== userId
        );
      }

      // Ajouter l'utilisateur à la liste des bannis si elle existe, sinon la créer
      if (!room.bannedUsers) {
        room.bannedUsers = [];
      }

      // Vérifier si l'utilisateur est déjà banni
      if (!room.bannedUsers.some((ban) => ban.userId.toString() === userId)) {
        room.bannedUsers.push({
          userId,
          bannedBy: socket.userData._id,
          reason: reason || "Aucune raison spécifiée",
          bannedAt: new Date(),
        });
      }

      // Sauvegarder les modifications
      await room.save({ session });

      const notificationPromises = room.members.map(
        async (memberId) =>
          await createNotification({
            recipient: memberId,
            type: "room_update",
            content: {
              title: "Member Banned",
              message: `${socket.userData.userName}--(KSD:${
                socket.userData.KSD
              })  has been banned from  the room "${room.name}". Raison: ${
                reason || "Aucune raison spécifiée"
              }`,
              roomId: room._id,
            },
          })
      );

      // Attendre que toutes les notifications soient créées
      const notifications = await Promise.all(notificationPromises);

      // Envoyer toutes les notifications en une seule fois

      await sendNotificationToUsers(io, notifications, global.connectedUsers);

      // Créer une notification pour l'utilisateur banni
      let userBannedNotification = await createNotification({
        recipient: userId,
        type: "room_update",
        content: {
          title: "Bannissement de room",
          message: `Vous avez été banni de la room "${room.name}". Raison: ${
            reason || "Aucune raison spécifiée"
          }`,
          roomId: room._id,
        },
      });
      await sendNotificationToUsers(
        io,
        [userBannedNotification],
        global.connectedUsers
      );
    } catch (error) {
      socket.emit("member:banned:error", {
        message: error.message,
      });
    } finally {
      session.endSession();
    }
  });
  // Ajouter un administrateur au groupe
  socket.on("add-group-admin", async (data) => {
    try {
      console.log(data, " here  is data salt");
      const { roomId, newAdminId } = data;

      if (!roomId || !socket.userData._id || !newAdminId) {
        return socket.emit("error", { message: "Informations incomplètes" });
      }

      // Vérifier si le groupe existe
      const group = await Room.findById(roomId);
      if (!group) {
        throw new Error("Room introuvable");
      }

      // Vérifier si l'utilisateur est administrateur
      if (!group.admins.includes(socket.userData._id)) {
        throw new Error("Vous n'êtes pas administrateur de ce groupe");
      }

      // Vérifier si le nouvel admin est membre du groupe
      if (!group.members.includes(newAdminId)) {
        throw new Error("L'utilisateur n'est pas membre du groupe");
      }
      // Vérifier si le nouvel admin est membre du groupe
      if (group.admins.includes(newAdminId)) {
        throw new Error("L'utilisateur est déjà un administracteur du groupe");
      }

      // Ajouter le nouvel administrateur
      const updatedGroup = await Room.findByIdAndUpdate(
        roomId,
        { $addToSet: { admins: newAdminId } },
        { new: true }
      );

      socket.emit("admin-add-success", {
        success: true,
        message: "Administrateur ajouté avec succès",
        group: updatedGroup,
      });
    } catch (error) {
      console.error("Erreur lors de l'ajout d'un administrateur:", error);
      socket.emit("error:add-group-admin", { message: error.message });
    }
  });
  // Rechercher des groupes à proximité
  socket.on("find-nearby-groups", async (data) => {
    //group = Room
    try {
      const { coordinates, radius = 1000, userId } = data;

      if (
        !coordinates ||
        !Array.isArray(coordinates) ||
        coordinates.length !== 2
      ) {
        return socket.emit("error", { message: "Coordonnées invalides" });
      }

      // Construire la requête
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

      // Exclure les groupes privés si l'utilisateur n'est pas membre
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

      socket.emit("nearby-groups", {
        groups: nearbyGroups,
        count: nearbyGroups.length,
        radius,
      });
    } catch (error) {
      console.error(
        "Erreur lors de la recherche de groupes à proximité:",
        error
      );
      socket.emit("error", {
        message: "Erreur serveur lors de la recherche de groupes",
      });
    }
  });
  // Évaluer un groupe
  socket.on("rate-group", async (data) => {
    //group = Room
    try {
      const { roomId, rating, comment = "" } = data;

      if (!roomId || rating === undefined || rating < 1 || rating > 5) {
        return socket.emit("error:rating", {
          message: "Informations d'évaluation invalides",
        });
      }

      // Vérifier si le groupe existe
      const group = await Room.findById(roomId);
      if (!group) {
        throw new Error("Groupe introuvable");
      }

      // Vérifier si l'utilisateur est membre du groupe
      if (!group.members.includes(socket.userData._id)) {
        throw new Error("Vous devez être membre du groupe pour l'évaluer");
      }

      // Vérifier si l'utilisateur a déjà évalué ce groupe
      const existingRatingIndex = group.ratings.findIndex(
        (r) => r.user && r.user.toString() === socket.userData._id
      );

      if (existingRatingIndex !== -1) {
        // Mettre à jour l'évaluation existante
        group.ratings[existingRatingIndex].rating = rating;
        group.ratings[existingRatingIndex].comment = comment;
        group.ratings[existingRatingIndex].createdAt = new Date();
      } else {
        // Ajouter une nouvelle évaluation
        group.ratings.push({
          user: socket.userData._id,
          rating,
          comment,
          createdAt: new Date(),
        });
      }

      // Recalculer la note moyenne
      if (group.ratings.length > 0) {
        const totalRating = group.ratings.reduce((sum, r) => sum + r.rating, 0);
        group.averageRating = totalRating / group.ratings.length;
      }

      const updatedGroup = await group.save();

      // Notifier les administrateurs du groupe
      const user = await User.findById(socket.userData._id).select(
        "userPseudo"
      );
      if (user) {
        const notificationPromises = group.admins.map(async (adminId) => {
          let rate = {
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
          };
          return await createNotification(rate);
        });
        // Attendre que toutes les notifications soient créées
        const notifications = await Promise.all(notificationPromises);

        // Envoyer toutes les notifications en une seule fois

        await sendNotificationToUsers(io, notifications, global.connectedUsers);
      }

      socket.emit("rating-success", {
        success: true,
        message: "Évaluation enregistrée avec succès",
        averageRating: updatedGroup.averageRating,
      });
    } catch (error) {
      console.error("Erreur lors de l'évaluation du groupe:", error);
      socket.emit("error:rating", {
        message: "Erreur serveur lors de l'évaluation du groupe",
      });
    }
  });
}
