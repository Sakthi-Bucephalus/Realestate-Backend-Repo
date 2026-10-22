const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const generateOtp = () => {
  // 6-digit random number between 100000 and 999999
  return crypto.randomInt(100000, 1000000).toString();
};

const hashOtp = async (otp) => {
  const salt = await bcrypt.genSalt(8);
  return bcrypt.hash(otp, salt);
};

const verifyOtp = async (candidateOtp, hashedOtp) => {
  if (!candidateOtp || !hashedOtp) return false;
  return bcrypt.compare(candidateOtp, hashedOtp);
};

module.exports = {
  generateOtp,
  hashOtp,
  verifyOtp,
};
