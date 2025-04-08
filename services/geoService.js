import mongoose from 'mongoose';
import User from '../models/user.model.js';
import Alert from '../models/alert.model.js';
import Business from '../models/business.model.js';
import Event from '../models/event.model.js';
import Group from '../models/group.model.js';

export const findNearbyUsers = async (coordinates, maxDistance = 1000, excludeUserId = null) => {
  try {
    const query = {
      'location.coordinates': {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: coordinates
          },
          $maxDistance: maxDistance
        }
      }
    };
    
    if (excludeUserId) {
      query._id = { $ne: excludeUserId };
    }
    
    return await User.find(query).select('-wallet -phone -email -phone  -lastLocation -profile.profileViewers -profile.statusViewers -statusShared');
  } catch (error) {
    console.error('Erreur lors de la recherche d\'utilisateurs à proximité:', error);
    throw error;
  }
};

export const findNearbyEntities = async (coordinates, maxDistance = 1000, model, filters = {}) => {
  try {
    const query = {
      'location.coordinates': {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: coordinates
          },
          $maxDistance: maxDistance
        }
      },
      ...filters
    };
    
    let ModelClass;
    switch (model) {
      case 'Alert':
        ModelClass = Alert;
        query.isActive = true;
        break;
      case 'Business':
        ModelClass = Business;
        break;
      case 'Event':
        ModelClass = Event;
        query.status = { $in: ['scheduled', 'active'] };
        query.startDate = { $gte: new Date() };
        break;
      case 'Group':
        ModelClass = Group;
        break;
      default:
        throw new Error('Modèle non supporté');
    }
    
    return await ModelClass.find(query);
  } catch (error) {
    console.error(`Erreur lors de la recherche de ${model} à proximité:`, error);
    throw error;
  }
};

export const updateUserLocation = async (userId, coordinates, address = null) => {
  try {
    return await User.findByIdAndUpdate(
      userId,
      {
        'location.coordinates': coordinates,
        'location.address': address,
        'lastLocation.coordinates': coordinates,
        'lastLocation.updatedAt': new Date()
      },
      { new: true }
    );
  } catch (error) {
    console.error('Erreur lors de la mise à jour de la localisation de l\'utilisateur:', error);
    throw error;
  }
};
