import express from 'express';
import { USER_ROLES } from '../../enums/user';
import auth from './auth';

/**
 * Signed in callers are identified; guests pass through and must prove the lead passenger
 * email in the service. Used by the booking and payment routes.
 */
const optionalAuth: express.RequestHandler = (req, res, next) => {
  if (req.headers.authorization) {
    return auth(USER_ROLES.USER, USER_ROLES.OPERATOR, USER_ROLES.ADMIN)(
      req,
      res,
      next,
    );
  }
  return next();
};

export default optionalAuth;
