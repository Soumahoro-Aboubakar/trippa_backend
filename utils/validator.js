// utils/validator.js
import mongoose from 'mongoose';

/**
 * Vérifie si une chaîne est un email valide
 * @param {String} email - L'email à vérifier
 * @returns {Boolean} true si l'email est valide
 */
export const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Vérifie si une chaîne est un numéro de téléphone valide
 * @param {String} phone - Le numéro de téléphone à vérifier
 * @returns {Boolean} true si le numéro est valide
 */
export const isValidPhone = (phone) => {
  // Format international avec ou sans + et avec des chiffres
  const phoneRegex = /^(\+?\d{1,3})?[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}$/;
  return phoneRegex.test(phone);
};

/**
 * Vérifie si un ID est un ObjectId MongoDB valide
 * @param {String} id - L'ID à vérifier
 * @returns {Boolean} true si l'ID est valide
 */
export const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};

/**
 * Vérifie si des coordonnées géographiques sont valides
 * @param {Number} longitude - La longitude à vérifier
 * @param {Number} latitude - La latitude à vérifier
 * @returns {Boolean} true si les coordonnées sont valides
 */
export const isValidCoordinates = (longitude, latitude) => {
  return (
    typeof longitude === 'number' &&
    typeof latitude === 'number' &&
    longitude >= -180 &&
    longitude <= 180 &&
    latitude >= -90 &&
    latitude <= 90
  );
};

/**
 * Vérifie si une URL est valide
 * @param {String} url - L'URL à vérifier
 * @returns {Boolean} true si l'URL est valide
 */
export const isValidUrl = (url) => {
  try {
    new URL(url);
    return true;
  } catch (error) {
    return false;
  }
};

/**
 * Vérifie si un type de média est autorisé
 * @param {String} type - Le type de média à vérifier
 * @returns {Boolean} true si le type est autorisé
 */
export const isAllowedMediaType = (type) => {
  const allowedTypes = ['image', 'video', 'audio', 'pdf', 'documents'];
  return allowedTypes.includes(type);
};

/**
 * Vérifie si un rayon est valide (en mètres)
 * @param {Number} radius - Le rayon à vérifier
 * @returns {Boolean} true si le rayon est valide
 */
export const isValidRadius = (radius) => {
  return typeof radius === 'number' && radius > 0 && radius <= 50000; // Maximum 50km
};

/**
 * Sanitize l'entrée utilisateur pour éviter les injections
 * @param {String} input - L'entrée à sanitizer
 * @returns {String} L'entrée sanitisée
 */
export const sanitizeInput = (input) => {
  if (typeof input !== 'string') return input;
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .trim();
};

export const dataParse = (data) => {
  try {
    return typeof data === 'string' ? JSON.parse(data) : data;
  } catch (error) {
    return null;
  }
}

export default {
  isValidEmail,
  isValidPhone,
  isValidObjectId,
  isValidCoordinates,
  isValidUrl,
  isAllowedMediaType,
  isValidRadius,
  sanitizeInput
};