const SECTIONS = ['Crèche', 'Kindergarten', 'Primary'];

const CLASS_LEVELS = {
  'Crèche': ['Crèche'],
  'Kindergarten': ['Kindergarten 1', 'Kindergarten 2'],
  'Primary': ['Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6']
};

const CLASS_ORDER = [
  'Crèche',
  'Kindergarten 1',
  'Kindergarten 2',
  'Primary 1',
  'Primary 2',
  'Primary 3',
  'Primary 4',
  'Primary 5',
  'Primary 6'
];

const SECTION_ORDER = ['Crèche', 'Kindergarten', 'Primary'];

function sectionForClass(className) {
  if (className && className.startsWith('Primary')) return 'Primary';
  if (className && className.startsWith('Kindergarten')) return 'Kindergarten';
  return 'Crèche';
}

function normalizeClassLevel(section, classLevel) {
  const allowed = CLASS_LEVELS[section];
  if (!allowed) return null;
  return allowed.includes(classLevel) ? classLevel : allowed[0];
}

function sectionRank(section) {
  const index = SECTION_ORDER.indexOf(section);
  return index === -1 ? SECTION_ORDER.length : index;
}

function classRank(className) {
  const index = CLASS_ORDER.indexOf(className);
  return index === -1 ? CLASS_ORDER.length : index;
}

module.exports = {
  SECTIONS,
  CLASS_LEVELS,
  CLASS_ORDER,
  SECTION_ORDER,
  sectionForClass,
  normalizeClassLevel,
  sectionRank,
  classRank
};
