const fs = require('fs');
const path = require('path');

const frontendDir = path.resolve('..', '..', 'Frontend', 'island-hop');
const sidebarPath = path.join(frontendDir, 'src', 'components', 'layouts', 'provider-sidebar', 'ProviderSidebar.tsx');

let content = fs.readFileSync(sidebarPath, 'utf8');

// Regex match for the nav items array
const regex = /(export const PROVIDER_NAV_ITEMS: ProviderNavItem\[\] = \[\r?\n\s+\{[\s\S]*?name: "Overview"[\s\S]*?\},)(\r?\n\s+\{[\s\S]*?name: "Ferries"[\s\S]*?\},)(\r?\n\s+\{[\s\S]*?name: "Routes"[\s\S]*?\},)/;

if (regex.test(content)) {
  content = content.replace(regex, '$1$3$2');
  fs.writeFileSync(sidebarPath, content, 'utf8');
  console.log('✓ Successfully swapped Routes (2nd) and Ferries (3rd) in ProviderSidebar.tsx');
} else {
  console.log('Regex did not match. Checking current order...');
  const checkRegex = /name: "Routes"[\s\S]*?name: "Ferries"/;
  if (checkRegex.test(content)) {
    console.log('Routes is already before Ferries.');
  } else {
    console.log('Unexpected content.');
  }
}
