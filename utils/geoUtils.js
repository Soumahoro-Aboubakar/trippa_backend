// utils/geoUtils.js

/**
 * Calcule la distance entre deux points géographiques en mètres
 * @param {Array} coords1 - Coordonnées du premier point [longitude, latitude]
 * @param {Array} coords2 - Coordonnées du deuxième point [longitude, latitude]
 * @returns {Number} - Distance en mètres
 */
export const calculateDistance = (coords1, coords2) => {
    // Convertir degrés en radians
    const toRadians = (degrees) => degrees * Math.PI / 180;
    
    const R = 6371e3; // Rayon de la Terre en mètres
    const φ1 = toRadians(coords1[1]); // latitude 1
    const φ2 = toRadians(coords2[1]); // latitude 2
    const Δφ = toRadians(coords2[1] - coords1[1]); // différence de latitude
    const Δλ = toRadians(coords2[0] - coords1[0]); // différence de longitude
    
    // Formule haversine
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    
    return R * c; // Distance en mètres
  };
  
  /**
   * Vérifie si un point est à l'intérieur d'un rayon donné
   * @param {Array} centerCoords - Coordonnées du centre [longitude, latitude]
   * @param {Array} pointCoords - Coordonnées du point à vérifier [longitude, latitude]
   * @param {Number} radiusInMeters - Rayon en mètres
   * @returns {Boolean} - True si le point est dans le rayon
   */
  export const isPointInRadius = (centerCoords, pointCoords, radiusInMeters) => {
    const distance = calculateDistance(centerCoords, pointCoords);
    return distance <= radiusInMeters;
  };
  
  /**
   * Crée un objet GeoJSON Point à partir de coordonnées
   * @param {Number} longitude - Longitude
   * @param {Number} latitude - Latitude
   * @returns {Object} - Objet GeoJSON Point
   */
  export const createGeoPoint = (longitude, latitude) => {
    return {
      type: 'Point',
      coordinates: [longitude, latitude]
    };
  };
  
  /**
   * Convertit une adresse en coordonnées géographiques (mock pour le moment)
   * Note: En production, vous devriez utiliser un service comme Google Maps ou OpenStreetMap
   * @param {String} address - Adresse à géocoder
   * @returns {Promise<Array>} - Promesse résolue avec les coordonnées [longitude, latitude]
   */
  export const geocodeAddress = async (address) => {
    // Mock - en production, utilisez une API de géocodage
    console.log(`Géocodage de l'adresse: ${address} (mock)`);
    // Retourne des coordonnées factices pour Paris
    return [2.3522, 48.8566];
  };
  
  /**
   * Calcule le centre d'un ensemble de points géographiques
   * @param {Array} points - Tableau de coordonnées [[lon1, lat1], [lon2, lat2], ...]
   * @returns {Array} - Centre [longitude, latitude]
   */
  export const calculateCenter = (points) => {
    if (!points || points.length === 0) {
      return [0, 0];
    }
    
    let sumLon = 0;
    let sumLat = 0;
    
    points.forEach(point => {
      sumLon += point[0];
      sumLat += point[1];
    });
    
    return [sumLon / points.length, sumLat / points.length];
  };
  
  /**
   * Convertit un rayon en mètres en degrés de longitude à une latitude donnée
   * @param {Number} radiusInMeters - Rayon en mètres
   * @param {Number} latitude - Latitude
   * @returns {Number} - Rayon en degrés de longitude
   */
  export const metersToLongitudeDegrees = (radiusInMeters, latitude) => {
    const earthRadius = 6371000; // Rayon de la Terre en mètres
    const radiusRatio = radiusInMeters / earthRadius;
    const latitudeRadians = (latitude * Math.PI) / 180;
    
    return (radiusRatio / Math.cos(latitudeRadians)) * (180 / Math.PI);
  };
  
  export default {
    calculateDistance,
    isPointInRadius,
    createGeoPoint,
    geocodeAddress,
    calculateCenter,
    metersToLongitudeDegrees
  };