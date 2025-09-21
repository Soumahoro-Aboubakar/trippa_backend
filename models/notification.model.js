import mongoose from "mongoose";

const NotificationSchema = new mongoose.Schema(
  {
    recipient: {
      //le destinataire de la notification
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    kickedBy: {
      type: String, //Permet de stocker l'Id de la personne qui à expulser un utilisateur x dans un groupe
    },
    type: {
      type: String,
      enum: [
        "message",
        "friend_request",
        "group_invitation",
        "group_nearby",
        "alert_nearby",
        "business_nearby",
        "status_view",
        "status_share",
        "payment_received",
        "payment_sent",
        "game_invitation",
        "status_deactivated",
        "status_reactivated",
        "system_notification",
        "payment_update",
        "refund_processed",
        "insufficient_funds",
        "room_update",
        "message_status_changed",
      ],
      required: true,
    },
    content: {
      title: String,
      message: String, //un texte pour laisser ou expliquer une consigne 
      status: String, //le nouveau status de l'entité concerné
      paymentId: String,
      //   messageId: String,
      room: mongoose.Schema.Types.ObjectId,
      count: Number,
      messagesIds: [
        {
          type: String,
        },
      ], //très important pour les messages qui sont concernés pas la notification
    },
    coinsEarned: {
      type: Number,
    },
    status: {
      type: String,
      enum: ["CREATED", "DELIVERED"],
      default: "CREATED",
    },
    relatedEntity: {
      entityType: {
        type: String,
        enum: [
          "Message",
          "User",
          "Room",
          "Alert",
          "Business",
          "Status",
          "Payment",
          "Event",
        ],
      },
      entityId: {
        type: mongoose.Schema.Types.ObjectId,
      },
    },
    isRead: {
      type: Boolean,
      default: false, //important pour les notification très important (exemple payement)
    },
    isSent: {
      type: Boolean,
      default: false,
    },
    isActionRequired: {
      type: Boolean,
      default: false,
    },
    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent"],
      default: "normal",
    },
    expiresAt: {
      type: Date,
    },
    data: {
      type: mongoose.Schema.Types.Mixed, // Données supplémentaires
    },
  },
  {
    timestamps: true,
  }
);

// Index pour faciliter la recherche des notifications non lues par utilisateur
NotificationSchema.index({ recipient: 1, isRead: 1 });
// Index pour l'expiration des notifications
NotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Méthode pour marquer une notification comme lue
NotificationSchema.methods.markAsRead = function () {
  this.isRead = true;
  return this.save();
};

// Méthode pour marquer une notification comme envoyée
NotificationSchema.methods.markAsSent = function () {
  this.isSent = true;
  return this.save();
};

// Méthode statique pour marquer toutes les notifications d'un utilisateur comme lues
NotificationSchema.statics.markAllAsRead = function (userId) {
  return this.updateMany(
    { recipient: userId, isRead: false },
    { $set: { isRead: true } }
  );
};

NotificationSchema.statics.getUnreadByUser = async function(userId, limit = 20, offset = 0) {
  if (!userId) return [];
  
  return await this.find({
    recipient: userId,
    status: 'CREATED'
  })
  .populate('sender', 'name avatar')
  .populate('content.room', 'name type')
  .sort({ createdAt: -1 })
  .limit(limit)
  .skip(offset)
  .lean() 
  .exec();
};

NotificationSchema.statics.getAllNotificationsForUser = async function(userId, options = {}) {
  const {
    limit = 50,
    offset = 0,
    includeRead = false,
    types = null, // Array de types spécifiques si besoin
    populate = true
  } = options;

  const pipeline = [
    {
      $match: {
        recipient: new mongoose.Types.ObjectId(userId),
        ...(includeRead ? {} : { status: "CREATED" }),
        ...(types ? { type: { $in: types } } : {})
      }
    },
    {
      $sort: { createdAt: -1 }
    },
    {
      $skip: offset
    },
    {
      $limit: limit
    }
  ];

  // Ajout des populations si nécessaire
  if (populate) {
    pipeline.push(
      {
        $lookup: {
          from: 'users',
          localField: 'sender',
          foreignField: '_id',
          as: 'senderInfo',
          pipeline: [
            { $project: { name: 1, avatar: 1, username: 1 } }
          ]
        }
      },
      {
        $lookup: {
          from: 'rooms',
          localField: 'content.room',
          foreignField: '_id',
          as: 'roomInfo',
          pipeline: [
            { $project: { name: 1, type: 1, avatar: 1, participants: 1 } }
          ]
        }
      }
    );
  }

  // Formatage final
  pipeline.push({
    $addFields: {
      sender: { $arrayElemAt: ['$senderInfo', 0] },
      room: { $arrayElemAt: ['$roomInfo', 0] },
      // Calculer des métadonnées utiles pour le front
      messageCount: {
        $cond: {
          if: { $eq: ['$type', 'message_status_changed'] },
          then: { $size: { $ifNull: ['$content.messagesIds', []] } },
          else: null
        }
      },
      // Indicateur de priorité visuelle
      isUrgent: { $eq: ['$priority', 'urgent'] },
      isHigh: { $eq: ['$priority', 'high'] },
      // Age de la notification en minutes (utile pour l'affichage)
      ageInMinutes: {
        $divide: [
          { $subtract: [new Date(), '$createdAt'] },
          1000 * 60
        ]
      }
    }
  });

  // Projection finale pour nettoyer
  pipeline.push({
    $project: {
      senderInfo: 0,
      roomInfo: 0,
      __v: 0
    }
  });

  const notifications = await this.aggregate(pipeline);
  
  // Obtenir le total pour la pagination
  const totalPipeline = [
    {
      $match: {
        recipient: new mongoose.Types.ObjectId(userId),
        ...(includeRead ? {} : { status: "CREATED" }),
        ...(types ? { type: { $in: types } } : {})
      }
    },
    {
      $count: "total"
    }
  ];
  
  const totalResult = await this.aggregate(totalPipeline);
  const total = totalResult[0]?.total || 0;

  return {
    notifications,
    pagination: {
      total,
      limit,
      offset,
      hasMore: total > offset + limit,
      totalPages: Math.ceil(total / limit),
      currentPage: Math.floor(offset / limit) + 1
    }
  };
};

// Index composé pour les requêtes de notifications fréquentes
NotificationSchema.index({ 
  recipient: 1, 
  status: 1, 
  isRead: 1 
});

// Index pour les notifications de changement de statut
NotificationSchema.index({
  type: 1,
  sender: 1,
  recipient: 1,
  "content.room": 1,
  "content.status": 1
});

const Notification = mongoose.model("Notification", NotificationSchema);
export default Notification;
