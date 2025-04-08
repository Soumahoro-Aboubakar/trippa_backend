// utils/errorHandler.js

/**
 * Classe pour les erreurs personnalisées de l'application
 */
export class AppError extends Error {
    constructor(message, statusCode, errorCode = null) {
      super(message);
      this.statusCode = statusCode;
      this.errorCode = errorCode;
      this.isOperational = true; // Erreur opérationnelle (peut être traitée)
  
      Error.captureStackTrace(this, this.constructor);
    }
  }
  
  /**
   * Fonction pour gérer les erreurs dans les contrôleurs async
   * @param {Function} fn - Fonction asynchrone à wrapper
   */
  export const catchAsync = (fn) => {
    return (req, res, next) => {
      fn(req, res, next).catch(next);
    };
  };
  
  /**
   * Middleware global de gestion des erreurs
   * @param {Error} err - L'erreur à traiter
   * @param {Object} req - Objet de requête Express
   * @param {Object} res - Objet de réponse Express
   * @param {Function} next - Fonction next d'Express
   */
  export const globalErrorHandler = (err, req, res, next) => {
    err.statusCode = err.statusCode || 500;
    
    // En développement, on renvoie plus de détails
    if (process.env.NODE_ENV === 'development') {
      return res.status(err.statusCode).json({
        status: 'error',
        message: err.message,
        errorCode: err.errorCode,
        stack: err.stack,
        error: err
      });
    }
    
    // En production, on est plus discret
    if (err.isOperational) {
      // Erreur contrôlée
      return res.status(err.statusCode).json({
        status: 'error',
        message: err.message,
        errorCode: err.errorCode
      });
    }
    
    // Erreur non contrôlée (bugs, erreurs de code)
    console.error('ERREUR 💥', err);
    res.status(500).json({
      status: 'error',
      message: 'Quelque chose s\'est mal passé',
      errorCode: 'INTERNAL_SERVER_ERROR'
    });
  };
  
  /**
   * Gestionnaire d'erreurs pour MongoDB
   * @param {Error} err - L'erreur MongoDB
   */
  export const handleMongoError = (err) => {
    if (err.name === 'ValidationError') {
      const errors = Object.values(err.errors).map(val => val.message);
      return new AppError(`Erreur de validation: ${errors.join('. ')}`, 400, 'VALIDATION_ERROR');
    }
    
    if (err.code === 11000) {
      const field = Object.keys(err.keyValue)[0];
      return new AppError(`Duplicata trouvé: ${field} existe déjà`, 400, 'DUPLICATE_ERROR');
    }
    
    return new AppError('Erreur de base de données', 500, 'DATABASE_ERROR');
  };
  
  /**
   * Fonction pour capturer et formater les erreurs Socket.io
   * @param {Function} fn - Fonction de gestionnaire Socket.io
   */
  export const catchSocketAsync = (fn) => {
    return (socket, data, callback) => {
      Promise.resolve(fn(socket, data, callback)).catch(err => {
        console.error('Socket Error:', err);
        if (callback && typeof callback === 'function') {
          callback({
            status: 'error',
            message: err.message || 'Une erreur est survenue',
            errorCode: err.errorCode || 'SOCKET_ERROR'
          });
        }
        
        // Émettre l'erreur au client
        socket.emit('error', {
          status: 'error',
          message: err.message || 'Une erreur est survenue',
          errorCode: err.errorCode || 'SOCKET_ERROR'
        });
      });
    };
  };
  
  export default {
    AppError,
    catchAsync,
    globalErrorHandler,
    handleMongoError,
    catchSocketAsync
  };