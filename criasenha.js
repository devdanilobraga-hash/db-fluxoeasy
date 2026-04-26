const bcrypt = require('bcryptjs'); 

//teste commit

(async () => {
  const hash = await bcrypt.hash('jms11728', 10);
  console.log(hash);
})();
