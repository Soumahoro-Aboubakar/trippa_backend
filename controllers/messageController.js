import Message from '../models/Message.js';
import User from '../models/User.js';
import Group from '../models/Group.js';
import { storeMedia } from '../services/mediaService.js';
import { getUserSocketId } from '../services/socketService.js';
import { postFile } from '../config/backblaze.js';

import { B2 } from '../config/backblaze.js';

// Envoyer un message privé via API REST
export const sendPrivateMessage = async (req, res) => {
  try {
    const { receiverId, content, type, isAnonymous } = req.body;

    // Vérifier si le destinataire existe
    const receiver = await User.findById(receiverId);
    if (!receiver) {
      return res.status(404).json({ message: 'Destinataire non trouvé' });
    }

    let mediaPath = null;
    let mediaSize = null;
    let mediaDuration = null;

    // Traiter le média s'il est fourni
    if (req.file) {
      let file = {
        buffer: req.file.buffer,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype
      }
      const mediaUrl = await postFile(file);
      mediaPath = mediaUrl;
      mediaSize = req.file.size;

      // Si durée fournie pour audio/vidéo
      if (req.body.mediaDuration) {
        mediaDuration = Number(req.body.mediaDuration);
      }
    }

    // Créer le message
    const message = new Message({
      sender: req.user.id,
      receiver: receiverId,
      content,
      type: type || 'text',
      isAnonymous: isAnonymous === 'true',
      mediaPath,
      mediaSize,
      mediaDuration
    });

    await message.save();

    // Notifier le destinataire via Socket.io s'il est connecté
    const io = req.app.get('io');
    const receiverSocketId = getUserSocketId(receiverId);//A  revoir

    if (receiverSocketId && io) {
      const populatedMessage = await message.populate('sender', 'userPseudo profile.photo');
      io.to(receiverSocketId).emit('message:received', { message: populatedMessage });
    }

    res.status(201).json(message);
  } catch (error) {
    console.error('Erreur lors de l\'envoi du message privé:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// Envoyer un message de groupe via API REST
export const sendGroupMessage = async (req, res) => {
  try {
    const { groupId, content, type, isAnonymous } = req.body;

    // Vérifier si le groupe existe
    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: 'Groupe non trouvé' });
    }

    // Vérifier si l'utilisateur est membre du groupe
    if (!group.members.includes(req.user.id)) {
      return res.status(403).json({ message: 'Vous n\'êtes pas membre de ce groupe' });
    }

    let mediaPath = null;
    let mediaSize = null;
    let mediaDuration = null;

    // Traiter le média s'il est fourni
    if (req.file) {
      const media = await storeMedia(req.file, 'messages');//A revoir
      mediaPath = media.url;
      mediaSize = req.file.size;

      // Si durée fournie pour audio/vidéo
      if (req.body.mediaDuration) {
        mediaDuration = Number(req.body.mediaDuration);
      }
    }

    // Créer le message
    const message = new Message({
      sender: req.user.id,
      group: groupId,
      content,
      type: type || 'text',
      isAnonymous: isAnonymous === 'true',
      mediaPath,
      mediaSize,
      mediaDuration
    });

    await message.save();

    // Notifier tous les membres du groupe via Socket.io
    const io = req.app.get('io');
    if (io) {
      const populatedMessage = await message.populate('sender', 'userPseudo profile.photo');
      io.to(`group:${groupId}`).emit('message:group', { message: populatedMessage });
    }

    res.status(201).json(message);
  } catch (error) {
    console.error('Erreur lors de l\'envoi du message de groupe:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// Récupérer les conversations privées
export const getPrivateConversations = async (req, res) => { //A revoir
  try {
    // Trouver les messages envoyés ou reçus par l'utilisateur
    const conversations = await Message.aggregate([
      {
        $match: {
          $or: [
            { sender: mongoose.Types.ObjectId(req.user.id) },
            { receiver: mongoose.Types.ObjectId(req.user.id) }
          ],
          group: { $exists: false }
        }
      },
      {
        $sort: { createdAt: -1 }
      },
      {
        $group: {
          _id: {
            $cond: [
              { $eq: ["$sender", mongoose.Types.ObjectId(req.user.id)] },
              "$receiver",
              "$sender"
            ]
          },
          lastMessage: { $first: "$$ROOT" },
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$receiver", mongoose.Types.ObjectId(req.user.id)] },
                    { $eq: ["$isRead", false] }
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "conversationUser"
        }
      },
      {
        $unwind: "$conversationUser"
      },
      {
        $project: {
          _id: 1,
          lastMessage: 1,
          unreadCount: 1,
          "conversationUser.userPseudo": 1,
          "conversationUser.profile.photo": 1
        }
      }
    ]);

    res.json(conversations);
  } catch (error) {
    console.error('Erreur lors de la récupération des conversations:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};