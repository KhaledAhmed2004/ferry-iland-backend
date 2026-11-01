import fs from 'fs';
import path from 'path';

const unlinkFile = (file: string) => {
  if (!file) return;
  const filePath = path.join('uploads', file);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    fs.unlinkSync(filePath);
  }
};

export default unlinkFile;
