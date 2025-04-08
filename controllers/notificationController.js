import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { sendPushNotification } from '../services/notificationService.js';

// Créer une nouvelle notification
export const createNotification = async (req, res) => {
  try {
    const { recipient, sender, type, title, message, relatedEntity, isActionRequired, priority, expiresAt, data } = req.body;

    // Vérifier si le destinataire existe
    const recipientUser = await User.findById(recipient);
    if (!recipientUser) {
      return res.status(404).json({ message: 'Destinataire non trouvé' });
    }

    const notification = new Notification({
      recipient,
      sender,
      type,
      title,
      message,
      relatedEntity,
      isActionRequired,
      priority,
      expiresAt,
      data
    });

    await notification.save();

    // Envoyer une notification push si possible
    if (recipientUser.deviceToken) {
      await sendPushNotification(recipientUser.deviceToken, title, message, data);
      notification.isSent = true;
      await notification.save();
    }

    res.status(201).json(notification);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Récupérer toutes les notifications d'un utilisateur
export const getUserNotifications = async (req, res) => { //A revoir
  try {
    const userId = req.params.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const notifications = await Notification.find({ recipient: userId, isRead: false })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('sender', 'userPseudo profile.photo')
      .populate('recipient', 'userPseudo');

    const total = await Notification.countDocuments({ recipient: userId , isRead : false });
    // Marquer les notifications récupérées comme lues
    if (notifications.length > 0) {
      const notificationIds = notifications.map(notif => notif._id);
      await Notification.updateMany(
        { _id: { $in: notificationIds } },
        { $set: { isRead: true } }
      );
    }
    res.status(200).json({
      notifications,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Marquer une notification comme lue
export const markNotificationAsRead = async (req, res) => {
  try {
    const notificationId = req.params.id;
    const notification = await Notification.findById(notificationId);

    if (!notification) {
      return res.status(404).json({ message: 'Notification non trouvée' });
    }

    if (notification.recipient.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Action non autorisée' });
    }

    notification.isRead = true;
    await notification.save();

    res.status(200).json(notification);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Marquer toutes les notifications d'un utilisateur comme lues
export const markAllNotificationsAsRead = async (req, res) => {
  try {
    const userId = req.params.userId;

    if (userId !== req.user.id) {
      return res.status(403).json({ message: 'Action non autorisée' });
    }

    await Notification.updateMany(
      { recipient: userId, isRead: false },
      { $set: { isRead: true } }
    );

    res.status(200).json({ message: 'Toutes les notifications ont été marquées comme lues' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Supprimer une notification
export const deleteNotification = async (req, res) => {
  try {
    const notificationId = req.params.id;
    const notification = await Notification.findById(notificationId);

    if (!notification) {
      return res.status(404).json({ message: 'Notification non trouvée' });
    }

    if (notification.recipient.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Action non autorisée' });
    }

    await notification.remove();
    res.status(200).json({ message: 'Notification supprimée' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Compter les notifications non lues
export const countUnreadNotifications = async (req, res) => {
  try {
    const userId = req.params.userId;

    if (userId !== req.user.id) {
      return res.status(403).json({ message: 'Action non autorisée' });
    }

    const count = await Notification.countDocuments({ recipient: userId, isRead: false });
    res.status(200).json({ count });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};