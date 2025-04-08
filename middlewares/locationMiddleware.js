// middlewares/locationMiddleware.js
import User from '../models/User.js';
import geoService from '../services/geoService.js';

/**
 * Middleware qui vérifie et met à jour la localisation de l'utilisateur
 */
export const updateUserLocation = async (req, res, next) => {
  try {
    const { userId } = req.user; // Supposons que l'ID de l'utilisateur soit disponible ici
    const { longitude, latitude } = req.body;

    // Vérifier si les coordonnées sont fournies
    if (!longitude || !latitude) {
      return res.status(400).json({ message: 'Les coordonnées de localisation sont requises' });
    }

    // Mettre à jour la localisation de l'utilisateur
    await User.findByIdAndUpdate(userId, {
      'location.coordinates': [parseFloat(longitude), parseFloat(latitude)],
      'lastLocation.coordinates': [parseFloat(longitude), parseFloat(latitude)],
      'lastLocation.updatedAt': new Date()
    });

    next();
  } catch (error) {
    console.error('Erreur lors de la mise à jour de la localisation:', error);
    res.status(500).json({ message: 'Erreur lors de la mise à jour de la localisation' });
  }
};

/**
 * Middleware qui enrichit la requête avec les utilisateurs à proximité
 * @param {Number} radius - Rayon en mètres (par défaut: 1000m)
 */
export const findNearbyUsers = (radius = 1000) => {
  return async (req, res, next) => {
    try {
      const { userId } = req.user;
      const user = await User.findById(userId);
      
      if (!user || !user.location || !user.location.coordinates) {
        return res.status(400).json({ message: 'Localisation de l\'utilisateur non disponible' });
      }
      
      // Utiliser le service géospatial pour trouver les utilisateurs à proximité
      const nearbyUsers = await geoService.findNearbyUsers(
        user.location.coordinates,
        radius,
        userId // Exclure l'utilisateur actuel
      );
      
      // Ajouter les utilisateurs à proximité à l'objet de requête
      req.nearbyUsers = nearbyUsers;
      next();
    } catch (error) {
      console.error('Erreur lors de la recherche des utilisateurs à proximité:', error);
      res.status(500).json({ message: 'Erreur lors de la recherche des utilisateurs à proximité' });
    }
  };
};

/**
 * Middleware qui enrichit la requête avec les entités à proximité (entreprises, alertes, événements)
 */
export const findNearbyEntities = async (req, res, next) => {
  try {
    const { userId } = req.user;
    const { entityType, radius = 1000 } = req.query;
    const user = await User.findById(userId);
    
    if (!user || !user.location || !user.location.coordinates) {
      return res.status(400).json({ message: 'Localisation de l\'utilisateur non disponible' });
    }
    
    // Trouver les entités à proximité selon le type demandé
    let nearbyEntities = [];
    switch (entityType) {
      case 'business':
        nearbyEntities = await geoService.findNearbyBusinesses(user.location.coordinates, radius);
        break;
      case 'alert':
        nearbyEntities = await geoService.findNearbyAlerts(user.location.coordinates, radius);
        break;
      case 'event':
        nearbyEntities = await geoService.findNearbyEvents(user.location.coordinates, radius);
        break;
      case 'group':
        nearbyEntities = await geoService.findNearbyGroups(user.location.coordinates, radius);
        break;
      default:
        // Si aucun type spécifié, on ne fait rien
        break;
    }
    
    // Ajouter les entités à proximité à l'objet de requête
    req.nearbyEntities = nearbyEntities;
    next();
  } catch (error) {
    console.error('Erreur lors de la recherche des entités à proximité:', error);
    res.status(500).json({ message: 'Erreur lors de la recherche des entités à proximité' });
  }
};

export default {
  updateUserLocation,
  findNearbyUsers,
  findNearbyEntities
};