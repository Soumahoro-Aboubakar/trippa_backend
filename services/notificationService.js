import Message from "../models/message.model.js";
import Notification from "../models/notification.model.js";
import { findNearbyUsers } from "./geoService.js";

export const createNotification = async (data) => {
  try {
    const notification = new Notification(data);
    await notification.save();
    console.log("Notification créée avec succès:", notification);

    return notification;
  } catch (error) {
    console.error("Erreur lors de la création de la notification:", error);
    throw error;
  }
};

export const sendAlertNotification = async (alert, io) => {
  try {
    // Trouver les utilisateurs à proximité de l'alerte
    const nearbyUsers = await findNearbyUsers(
      alert.location.coordinates,
      alert.radius,
      alert.creator
    );

    // Créer et envoyer une notification pour chaque utilisateur à proximité
    const notifications = [];

    for (const user of nearbyUsers) {
      const notification = await createNotification({
        recipient: user._id,
        sender: alert.creator,
        type: "alert_nearby",
        title: `Alerte: ${alert.type}`,
        message: alert.description,
        relatedEntity: {
          entityType: "Alert",
          entityId: alert._id,
        },
        priority: alert.type === "danger" ? "urgent" : "high",
        isActionRequired: true,
      });

      notifications.push(notification);

      // Notifier via Socket.io si l'utilisateur est connecté
      const userSocketId = getUserSocketId(user._id, io);
      if (userSocketId) {
        io.to(userSocketId).emit("notification:new", notification);
      }
    }

    return notifications;
  } catch (error) {
    console.error("Erreur lors de l'envoi des notifications d'alerte:", error);
    throw error;
  }
};

// Fonction auxiliaire pour trouver le socket d'un utilisateur
const getUserSocketId = (userId, io) => {
  let userSocketId = null;

  // Parcourir tous les sockets connectés pour trouver celui de l'utilisateur
  io.sockets.sockets.forEach((socket) => {
    if (socket.user && socket.user.id.toString() === userId.toString()) {
      userSocketId = socket.id;
    }
  });

  return userSocketId;
};

// Envoyer une notification à tous les utilisateurs près d'un événement
export const sendEventNotification = async (event, io) => {
  try {
    const nearbyUsers = await findNearbyUsers(
      event.location.coordinates,
      event.visibilityRadius,
      event.creator
    );

    const notifications = [];

    for (const user of nearbyUsers) {
      const notification = await createNotification({
        recipient: user._id,
        sender: event.creator,
        type: "group_nearby",
        title: `Événement à proximité: ${event.title}`,
        message: event.description.substring(0, 100) + "...",
        relatedEntity: {
          entityType: "Event",
          entityId: event._id,
        },
        priority: "normal",
      });

      notifications.push(notification);

      const userSocketId = getUserSocketId(user._id, io);
      if (userSocketId) {
        io.to(userSocketId).emit("notification:new", notification);
      }
    }

    return notifications;
  } catch (error) {
    console.error(
      "Erreur lors de l'envoi des notifications d'événement:",
      error
    );
    throw error;
  }
};

// Fonction pour marquer isRead et isSent à true
export const markNotificationAsReadAndSent = async (
  notificationId,
  userId,
  socket
) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      {
        _id: notificationId,
        recipient: userId, // Vérification que l'utilisateur est bien le destinataire
      },
      {
        $set: {
          isRead: true,
          isSent: true,
        },
      },
      { new: true } // Retourne le document modifié
    ).populate("sender", "username avatar");

    if (!notification) {
      throw new Error("Notification non trouvée ou non autorisée");
    }

    // Émission socket.io uniquement au destinataire
    const recipientSockets = connectedUsers.get(
      notification.recipient.toString()
    );
    if (recipientSockets) {
      recipientSockets.forEach((socketId) => {
        socket.to(socketId).emit("notification_updated", notification);
      });
    }

    return notification;
  } catch (error) {
    console.error("Erreur lors de la mise à jour:", error);
    return null;
  }
};

// Fonction pour supprimer une notification avec vérification des droits
export const deleteUserNotification = async (
  notificationId,
  userId,
  socket
) => {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: notificationId,
      recipient: userId, // Seul le destinataire peut supprimer
    });

    if (!notification) {
      throw new Error("Notification non trouvée ou non autorisée");
    }

    // Émission socket.io de la suppression
    const recipientSockets = connectedUsers.get(userId.toString());
    if (recipientSockets) {
      recipientSockets.forEach((socketId) => {
        socket.to(socketId).emit("notification_deleted", {
          _id: notificationId,
          recipient: userId,
        });
      });
    }

    return true;
  } catch (error) {
    console.error("Erreur lors de la suppression:", error);
    return false;
  }
};

export const sendUnreadNotifications = async (socket) => {
  try {
    const newNotifications = await Notification.getUnreadByUser(
      socket.userData._id
    );
    socket.emit("newNotifications", {
      notifications: newNotifications,
      code: 200,
    });
  } catch (error) {
    console.error("Erreur lors de la récupération des notifications :", error);
  }
};
