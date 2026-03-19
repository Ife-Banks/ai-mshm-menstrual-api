const prisma = require('../db/prisma');

module.exports = async function resolveUser(req, res, next) {
  try {
    const externalId = req.user.external_id;

    if (!externalId) {
      return res.status(401).json({
        success: false, status: 401,
        message: 'JWT external_id claim missing — cannot identify user',
        meta: {
          request_id: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }

    let user = await prisma.user.findUnique({
      where: { externalId },
    });

    if (!user) {
      user = await prisma.user.create({
        data: { externalId },
      });
    }

    req.dbUser = user;
    next();
  } catch (err) {
    next(err);
  }
};
