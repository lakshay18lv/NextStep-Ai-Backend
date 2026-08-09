const errorHandler = (err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({
    message: err.message || "Internal server error",
    errors: err.errors || null,
  });
};

module.exports = errorHandler;
