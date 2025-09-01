const bcrypt = require('bcrypt');

(async () => {
  const hash = await bcrypt.hash('admin', 10);
  console.log(hash);
})();
