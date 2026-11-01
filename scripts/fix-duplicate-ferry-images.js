const fs = require('fs');
const path = require('path');

const filePath = path.resolve('..', '..', 'Frontend', 'island-hop', 'src', 'app', '(operator-dashboard)', 'dashboard', 'operator', 'ferries', 'page.tsx');

let code = fs.readFileSync(filePath, 'utf8');

const target = 'export { DEFAULT_FERRY_IMAGES, getDynamicVesselImage } from "@/data/media-catalog";';
const replacement = 'import { DEFAULT_FERRY_IMAGES, getDynamicVesselImage } from "@/data/media-catalog";\nexport { DEFAULT_FERRY_IMAGES, getDynamicVesselImage };';

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('✓ Successfully imported and exported DEFAULT_FERRY_IMAGES & getDynamicVesselImage!');
} else {
  console.log('Already updated or target not found');
}
