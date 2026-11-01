import jwt, { JwtPayload, Secret, SignOptions, VerifyOptions } from 'jsonwebtoken';

const createToken = (payload: object, secret: Secret, expireTime: string) => {
  return jwt.sign(payload, secret, {
    expiresIn: expireTime,
    algorithm: 'HS256',
  } as SignOptions);
};

const verifyToken = (token: string, secret: Secret): JwtPayload => {
  return jwt.verify(token, secret, {
    algorithms: ['HS256'],
  } as VerifyOptions) as JwtPayload;
};

export const jwtHelper = { createToken, verifyToken };
