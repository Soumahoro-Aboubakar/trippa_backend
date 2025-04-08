import jwt from 'jsonwebtoken';
import User from '../models/User.js';

// Vérifier si l'utilisateur est authentifié
export const authenticate = async (req, res, next) => {
  try {
    // Récupérer le token du header d'autorisation
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Accès non autorisé. Token manquant' });
    }

    // Extraire le token
    const token = authHeader.split(' ')[1];
    
    // Vérifier le token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Vérifier si l'utilisateur existe toujours
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ message: 'Utilisateur non trouvé' });
    }
    
    // Ajouter l'utilisateur à l'objet request
    req.user = {
      id: user._id,
      userPseudo: user.userPseudo,
      email: user.email,
      phone: user.phone
    };
    
    // Mettre à jour la dernière connexion
    await User.findByIdAndUpdate(user._id, { lastConnection: new Date() });
    
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Token invalide' });
    } else if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expiré' });
    }
    return res.status(500).json({ message: error.message });
  }
};

// Vérifier si l'utilisateur est un admin
export const isAdmin = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user || !user.isAdmin) {
      return res.status(403).json({ message: 'Accès refusé. Droits d\'administrateur requis' });
    }
    
    next();
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Vérifier si l'utilisateur est le propriétaire ou un admin
export const isOwnerOrAdmin = (model) => {
  return async (req, res, next) => {
    try {
      const itemId = req.params.id;
      const item = await model.findById(itemId);
      
      if (!item) {
        return res.status(404).json({ message: 'Élément non trouvé' });
      }
      
      const user = await User.findById(req.user.id);
      const isOwner = item.creator?.toString() === req.user.id || 
                       item.owner?.toString() === req.user.id || 
                       item.user?.toString() === req.user.id;
      
      if (!isOwner && !user.isAdmin) {
        return res.status(403).json({ message: 'Accès refusé. Vous n\'êtes pas autorisé à effectuer cette action' });
      }
      
      next();
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  };
};

// Vérifier si l'utilisateur a un abonnement actif
export const hasActiveSubscription = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user.subscription || !user.subscription.isActive) {
      return res.status(403).json({ message: 'Abonnement requis pour cette fonctionnalité' });
    }
    
    next();
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Vérifier les quotas d'utilisation (par exemple, limite de création d'articles)
export const checkQuota = (quotaType, model) => {
  return async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id);
      
      // Vérifier les quotas selon le type
      switch (quotaType) {
        case 'status':
          // Exemple: limite de 5 statuts par jour pour les utilisateurs non premium
          if (!user.subscription?.isActive) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const count = await model.countDocuments({
              creator: user._id,
              createdAt: { $gte: today }
            });
            
            if (count >= 5) {
              return res.status(403).json({ 
                message: 'Limite quotidienne de création de statuts atteinte. Passez à un abonnement premium pour plus.'
              });
            }
          }
          break;
          
        case 'business_products':
          // Exemple: limite de produits pour les entreprises
          const businessId = req.params.businessId || req.body.businessId;
          const business = await Business.findById(businessId);
          
          if (!business) {
            return res.status(404).json({ message: 'Entreprise non trouvée' });
          }
          
          if (!business.isSubscriptionActive && business.products?.length >= business.productLimit) {
            return res.status(403).json({ 
              message: `Limite de ${business.productLimit} produits atteinte. Activez un abonnement pour en ajouter plus.`
            });
          }
          break;
          
        default:
          break;
      }
      
      next();
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  };
};