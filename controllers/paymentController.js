import mongoose from 'mongoose';
import Payment from '../models/payment.model.js';
import User from '../models/user.model.js';
import Group from '../models/group.model.js';
import Business from '../models/business.model.js';
import Status from '../models/status.model.js';
import { dataParse } from '../utils/validator.js';
import { createNotification } from '../services/notificationService.js';


// Créer un nouveau paiement

const depositText = "deposit";
export function setupPaymentSocket(socket) {
    socket.on('create:payment', async (paymentData) => {
        const session = await mongoose.startSession();

        try {
            const {
                recipientId,
                amount,
                currency,
                type,
                paymentMethod,
                relatedEntity
            } = dataParse(paymentData);

            // Validation du destinataire pour les transactions entre utilisateurs
            if ((type !== depositText && type !== "gift") && (!mongoose.Types.ObjectId.isValid(recipientId) || recipientId === socket.userData._id)) {
                throw new Error('ID destinataire invalide ou identique à l\'expéditeur');
            }

            // Calcul des coins
            const coinsEarned = type === depositText ? Math.floor(amount) : 0;

            // Création du paiement
            const payment = new Payment({
                user: socket.userData._id,
                recipient: type != depositText ? recipientId : null,
                amount,
                currency,
                coinsEarned,
                type,
                paymentMethod,
                relatedEntity,
                status: 'pending'
            });

            await payment.save({ session });

            // Vérification du solde pour les transferts
            if (type != depositText) {
                const sender = await User.findById(socket.userData._id)
                    .session(session)
                    .select('wallet userPseudo KSD');

                if (!sender) {
                    throw new Error('Expéditeur non trouvé');
                }

                if (sender.wallet.balance < amount) {
                    throw new Error('Solde insuffisant');
                }

                // Débit du compte expéditeur
                sender.wallet.balance -= amount;
                sender.wallet.transactions.push(payment._id);
                await sender.save({ session });

                // Crédit du compte destinataire
                const recipient = await User.findById(recipientId)
                    .session(session)
                    .select('wallet userPseudo KSD');

                if (!recipient) {
                    throw new Error('Destinataire non trouvé');
                }

                recipient.wallet.balance += amount;
                recipient.wallet.transactions.push(payment._id);
                await recipient.save({ session });

                // Mise à jour du statut de paiement à completed pour les transferts
                payment.status = 'completed';
                await payment.save({ session });

                // Notifications pour l'expéditeur et le destinataire
                const senderNotification = await createNotification({
                    recipient: socket.userData._id,
                    type: 'payment_sent',
                    content: {
                        title: 'Transfert effectué',
                        message: `Transfert de ${amount} ${currency} à ${recipient.userPseudo || recipient.KSD} effectué avec succès`,
                        paymentId: payment._id,
                        status: payment.status
                    }
                });

                const recipientNotification = await createNotification({
                    recipient: recipientId,
                    type: 'payment_received',
                    content: {
                        title: 'Transfert reçu',
                        message: `Vous avez reçu ${amount} ${currency} de ${sender.userPseudo || sender.KSD}`,
                        paymentId: payment._id,
                        status: payment.status
                    }
                });

                // Envoi de notifications en temps réel si les utilisateurs sont connectés
                // Envoi de notifications
                const recipientSocketId = global.connectedUsers.get(recipient._id.toString())
                socket.emit('notification', senderNotification);
                if (recipientSocketId) {
                    socket.to(recipientSocketId).emit('notification', recipientNotification);
                }
            }
            // Gestion des dépôts
            else if (type === depositText && coinsEarned > 0) {
                const user = await User.findById(socket.userData._id)
                    .session(session)
                    .select('wallet');

                if (!user) {
                    throw new Error('Utilisateur non trouvé');
                }

                user.wallet.balance += coinsEarned;
                user.wallet.transactions.push(payment._id);
                await user.save({ session });

                // Notification pour le dépôt
                const depositNotification = await createNotification({
                    recipient: socket.userData._id,
                    type: 'payment_received',
                    content: {
                        title: 'Transaction en cours',
                        message: `Dépôt de ${amount} ${currency} en traitement`,
                        paymentId: payment._id,
                        status: payment.status
                    }
                });

                socket.emit('notification', depositNotification);

            }

            // Commit de la transaction
            session.endSession();

            // Réponse optimisée
            socket.emit('payment:created:success', {
                _id: payment._id,
                status: payment.status,
                coinsEarned: type === depositText ? coinsEarned : 0,
            });

        } catch (error) {
            // Logging serveur
            console.error(`[Payment Error] ${error.message}`, {
                userId: paymentData?.userId,
                recipientId: paymentData?.recipientId,
                error: error.stack
            });

            // Réponse d'erreur sécurisée
            socket.emit('payment:created:error', {
                code: error.message.includes('Solde insuffisant') ? 'INSUFFICIENT_BALANCE' : 'PAYMENT_FAILURE',
                message: error.message.includes('Solde insuffisant') ?
                    'Solde insuffisant pour effectuer cette transaction' :
                    'Échec du traitement du paiement',
                retryable: !error.message.includes('invalide') && !error.message.includes('Solde insuffisant')
            });
        } finally {
            session.endSession();
        }
    });
}


/* export const createPayment = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { userId, amount, currency, type, paymentMethod, relatedEntity } = req.body; //usser ici correspond a userID

        // Calculer les coins gagnés (1 euro = 100 coins par exemple)
        const coinsEarned = type === 'deposit' ? Math.floor(amount) : 0;

        const payment = new Payment({
            user: userId,
            amount,
            currency,
            coinsEarned,
            type,
            paymentMethod,
            relatedEntity, //Cette valeur viends depuis le frontend
            status: 'pending'
        });

        await payment.save({ session });

        // Si c'est un dépôt, ajouter des coins au portefeuille de l'utilisateur
        if (type === 'deposit' && coinsEarned > 0) {
            const userDoc = await User.findById(userId).session(session);
            if (!userDoc) {
                throw new Error('Utilisateur non trouvé');
            }

            userDoc.wallet.balance += coinsEarned;
            userDoc.wallet.transactions.push(payment._id);
            await userDoc.save({ session });
        }

        await session.commitTransaction();
        session.endSession();

        // Créer une notification pour l'utilisateur
        // 6. Notification plus détaillée
        const notificationMessage = type === 'deposit'
            ? `Votre dépôt de ${amount} ${currency} est en cours de traitement.`
            : `Paiement de ${amount} ${currency} initié.`;
        await createNotification({
            body: {
                recipient: userId,
                type: 'payment_received',
                title: 'Paiement initialisé',
                message: notificationMessage,
                relatedEntity: {
                    entityType: 'Payment',
                    entityId: payment._id
                },
                priority: 'normal'
            }
        });

        res.status(201).json(payment);
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        res.status(500).json({ message: error.message });
    }
}; */

// Confirmer un paiement
export const confirmPayment = async (req, res) => {
    const session = await mongoose.startSession();
    //  session.startTransaction();

    try {
        const { paymentId } = req.params;
        const payment = await Payment.findById(paymentId).session(session);

        if (!payment) {
            return res.status(404).json({ message: 'Paiement non trouvé' });
        }

        if (payment.status !== 'pending') {
            return res.status(400).json({ message: `Le paiement est déjà ${payment.status}` });
        }

        payment.status = 'completed';
        await payment.save({ session });

        // Traitement spécifique selon le type de paiement
        switch (payment.type) {
            case 'group-subscription':
                await handleGroupSubscription(payment, session);
                break;
            case 'status-promotion':
                await handleStatusPromotion(payment, session);
                break;
            case 'verification-payment':
                await handleVerificationPayment(payment, session);
                break;
            case 'functionnality-upgrade':
                await handleFunctionalityUpgrade(payment, session);
                break;
            // Autres types de paiements
        }

        // Créer une notification pour l'utilisateur
        await createNotification({
            body: {
                recipient: payment.user,
                type: 'payment_received',
                title: 'Paiement confirmé',
                message: `Votre paiement de ${payment.amount} ${payment.currency} a été confirmé.`,
                relatedEntity: {
                    entityType: 'Payment',
                    entityId: payment._id
                },
                priority: 'normal'
            }
        });

        //await session.commitTransaction();
        session.endSession();

        res.status(200).json(payment);
    } catch (error) {
        // await session.abortTransaction();
        session.endSession();
        res.status(500).json({ message: error.message });
    }
};

// Gérer les abonnements de groupe
const handleGroupSubscription = async (payment, session) => {
    if (!payment.relatedEntity || payment.relatedEntity.entityType !== 'Group') {
        throw new Error('Entité de groupe non valide');
    }

    const group = await Group.findById(payment.relatedEntity.entityId).session(session);
    if (!group) {
        throw new Error('Groupe non trouvé');
    }

    // Ajouter l'utilisateur comme membre du groupe s'il n'en fait pas déjà partie
    if (!group.members.includes(payment.user)) {
        group.members.push(payment.user);
        await group.save({ session });
    }
};

// Gérer les promotions de statut
const handleStatusPromotion = async (payment, session) => {
    if (!payment.relatedEntity || payment.relatedEntity.entityType !== 'Status') {
        throw new Error('Entité de statut non valide');
    }

    const status = await Status.findById(payment.relatedEntity.entityId).session(session);
    if (!status) {
        throw new Error('Statut non trouvé');
    }

    status.isPromoted = true;
    //  status.promotionRadius = payment.data?.radius || 1000; // Rayon par défaut ou spécifié (pas oubligatoire)
    await status.save({ session });
};

// Gérer les paiements de vérification
const handleVerificationPayment = async (payment, session) => {
    if (payment.relatedEntity.entityType === 'Business') {
        const business = await Business.findById(payment.relatedEntity.entityId).session(session);
        if (!business) {
            throw new Error('Entreprise non trouvée');
        }

        business.isVerified = true;//Verifie si l'entreprise est verifié on lui donne un badge
        await business.save({ session });
    }
    // Autres types de vérification possibles
};

// Gérer les mises à niveau de fonctionnalités
const handleFunctionalityUpgrade = async (payment, session) => {
    const user = await User.findById(payment.user).session(session);
    if (!user) {
        throw new Error('Utilisateur non trouvé');
    }

    // Logique pour ajouter des fonctionnalités premium selon le payment.data
    // Exemple: user.premiumFeatures = [...user.premiumFeatures, ...payment.data.features];

    await user.save({ session });
};

// Récupérer les paiements d'un utilisateur
export const getUserPayments = async (req, res) => {
    try {
        const userId = req.params.userId;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        const payments = await Payment.find({ user: userId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Payment.countDocuments({ user: userId });

        res.status(200).json({
            payments,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            total
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Récupérer un paiement spécifique
export const getPaymentById = async (req, res) => {
    try {
        const payment = await Payment.findById(req.params.id);
        if (!payment) {
            return res.status(404).json({ message: 'Paiement non trouvé' });
        }
        res.status(200).json(payment);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Rembourser un paiement
export const refundPayment = async (req, res) => {
    const session = await mongoose.startSession();
    // session.startTransaction();

    try {
        const { paymentId } = req.params;
        const payment = await Payment.findById(paymentId).session(session);

        if (!payment) {
            return res.status(404).json({ message: 'Paiement non trouvé' });
        }

        if (payment.status !== 'completed') {
            return res.status(400).json({ message: 'Seuls les paiements complétés peuvent être remboursés' });
        }

        payment.status = 'refunded';
        await payment.save({ session });

        // Rembourser les coins dans le portefeuille si nécessaire
        if (payment.type === 'deposit') {
            const user = await User.findById(payment.user).session(session);
            if (user && user.wallet.balance >= payment.coinsEarned) {
                user.wallet.balance -= payment.coinsEarned;
                await user.save({ session });
            }
        }

        // Traitement spécifique selon le type de paiement pour annuler les effets
        // Ex: désactiver la promotion, retirer l'utilisateur du groupe, etc.

        //  await session.commitTransaction();
        session.endSession();

        res.status(200).json(payment);
    } catch (error) {
        // await session.abortTransaction();
        session.endSession();
        res.status(500).json({ message: error.message });
    }
};

// Calcul des statistiques de paiement
export const getPaymentStats = async (req, res) => {
    try {
        const userId = req.params.userId;

        // Total dépensé
        const spent = await Payment.aggregate([
            {
                $match: {
                    user: mongoose.Types.ObjectId(userId),
                    type: { $in: ['group-subscription', 'status-promotion', 'product-purchase', 'verification-payment', 'functionnality-upgrade'] },
                    status: 'completed'
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$amount' }
                }
            }
        ]);

        // Total déposé
        const deposited = await Payment.aggregate([
            {
                $match: {
                    user: mongoose.Types.ObjectId(userId),
                    type: 'deposit',
                    status: 'completed'
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$amount' }
                }
            }
        ]);

        // Total retiré
        const withdrawn = await Payment.aggregate([
            {
                $match: {
                    user: mongoose.Types.ObjectId(userId),
                    type: 'withdrawal',
                    status: 'completed'
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$amount' }
                }
            }
        ]);

        // Statistiques par type de paiement
        const stats = await Payment.aggregate([
            {
                $match: {
                    user: mongoose.Types.ObjectId(userId),
                    status: 'completed'
                }
            },
            {
                $group: {
                    _id: '$type',
                    count: { $sum: 1 },
                    total: { $sum: '$amount' }
                }
            }
        ]);

        res.status(200).json({
            spent: spent.length ? spent[0].total : 0,
            deposited: deposited.length ? deposited[0].total : 0,
            withdrawn: withdrawn.length ? withdrawn[0].total : 0,
            stats: stats.reduce((acc, curr) => {
                acc[curr._id] = { count: curr.count, total: curr.total };
                return acc;
            }, {})
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};