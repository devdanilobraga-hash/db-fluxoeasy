const bcrypt = require('bcryptjs'); 

(async () => {
  const hash = await bcrypt.hash('jms11728', 10);
  console.log(hash);
})();
