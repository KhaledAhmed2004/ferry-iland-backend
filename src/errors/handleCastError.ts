import { Error } from 'mongoose';
import { IErrorMessage } from '../types/errors.types';

const handleCastError = (error: Error.CastError) => {
  const errorMessages: IErrorMessage[] = [
    {
      path: error.path,
      message: `Invalid value '${error.value}' for field '${error.path}'`,
    },
  ];

  const statusCode = 400;
  return {
    statusCode,
    message: 'Invalid ID format',
    errorMessages,
  };
};

export default handleCastError;
