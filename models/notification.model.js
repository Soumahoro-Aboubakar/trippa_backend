import mongoose from 'mongoose';


const NotificationSchema = new mongoose.Schema({
    recipient: { //le destinataire de la notification
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }, 
    kickedBy: {
        type: String, //Permet de stocker l'Id de la personne qui à expulser un utilisateur x dans un groupe

    },
    type: {
        type: String,
        enum: [
            'message',
            'friend_request',
            'group_invitation',
            'group_nearby',
            'alert_nearby',
            'business_nearby',
            'status_view',
            'status_share',
            'payment_received',
            'payment_sent',
            'game_invitation',
            "status_deactivated",
            "status_reactivated",
            'system_notification',
            "payment_update",
            "refund_processed",
            "insufficient_funds",
            "room_update",
            "message_status_changed"
        ],
        required: true
    },
    content: {
        title: String,
        message: String,
        status: String, //le nouveau status de l'entité concerné
        paymentId: String,
     //   messageId: String,
        room:  mongoose.Schema.Types.ObjectId,
        messagesIds : [], //très important pour les messages qui sont concernés pas la notification
    },
    coinsEarned: {
        type: Number,
    },
    status: {
        type: String,
        enum: ['CREATED', 'DELIVERED'],
        default: 'CREATED'
    },
    relatedEntity: {
        entityType: {
            type: String,
            enum: ['Message', 'User', 'Room', 'Alert', 'Business', 'Status', 'Payment', 'Event']
        },
        entityId: {
            type: mongoose.Schema.Types.ObjectId
        }
    },
    isRead: {
        type: Boolean,
        default: false //important pour les notification très important (exemple payement)
    },
    isSent: {
        type: Boolean,
        default: false
    },
    isActionRequired: {
        type: Boolean,
        default: false
    },
    priority: {
        type: String,
        enum: ['low', 'normal', 'high', 'urgent'],
        default: 'normal'
    },
    expiresAt: {
        type: Date
    },
    data: {
        type: mongoose.Schema.Types.Mixed // Données supplémentaires 
    },
}, {
    timestamps: true
});

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


// Méthode statique pour récupérer les notifications non lues d'un utilisateur
NotificationSchema.statics.getUnreadByUser = async function (userId) {
    if(!userId) return []; 
    return await this.find(
            { recipient: userId, status: 'CREATED' }
        ).sort({ createdAt: -1 }).exec();
};

const Notification = mongoose.model('Notification', NotificationSchema);
export default Notification;