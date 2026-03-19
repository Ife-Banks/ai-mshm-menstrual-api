const Joi = require('joi');

const aggregatedSchema = Joi.object({
  CLV:                 Joi.number().min(0).required()
                         .description('Cycle Length Variability — std dev of cycle lengths (days). Use 0 if < 3 cycles logged.'),
  mean_cycle_len:      Joi.number().min(10).max(90).required()
                         .description('Mean cycle length in days across all logged cycles.'),
  mean_luteal:         Joi.number().min(0).max(30).required()
                         .description('Mean luteal phase length in days. Use 14 if unknown.'),
  luteal_std:          Joi.number().min(0).required()
                         .description('Std dev of luteal phase length. Use 0 if < 3 cycles.'),
  anovulatory_rate:    Joi.number().min(0).max(1).required()
                         .description('Fraction of cycles with no detected ovulation peak (0–1). 0 = always ovulated.'),
  mean_menses_len:     Joi.number().min(0).max(14).required()
                         .description('Mean menstrual bleeding length in days.'),
  mean_menses_score:   Joi.number().min(0).max(24).required()
                         .description('Mean total menses score — cumulative daily bleeding score (Spotting=1, Light=2, Medium=3, Heavy=4) summed per period.'),
  unusual_bleed_rate:  Joi.number().min(0).max(1).required()
                         .description('Fraction of cycles with unusual/intermenstrual bleeding flagged (0–1).'),
  mean_fertility_days: Joi.number().min(0).max(30).required()
                         .description('Mean number of fertile window days per cycle.'),
  n_cycles:            Joi.number().integer().min(1).required()
                         .description('Total number of cycles logged by this client.'),
});

const cycleEntrySchema = Joi.object({
  period_start_date: Joi.string().isoDate().required()
    .description('Period start date — ISO format YYYY-MM-DD'),
  period_end_date:   Joi.string().isoDate().required()
    .description('Period end date — ISO format YYYY-MM-DD'),
  bleeding_scores:   Joi.array()
    .items(Joi.number().integer().min(1).max(4))
    .min(1).required()
    .description('Daily bleeding intensity per day of period. 1=Spotting, 2=Light, 3=Medium, 4=Heavy.'),
  has_ovulation_peak: Joi.boolean().required()
    .description('Did BBT chart / rPPG camera detect an ovulation peak this cycle?'),
  unusual_bleeding:   Joi.boolean().required()
    .description('Was there any bleeding outside the normal period this cycle?'),
  rppg_ovulation_day: Joi.number().integer().min(1).max(35).allow(null).default(null)  // ← ADD THIS
    .description('Optional: ovulation day detected by rPPG or wearable sensor. If null, server estimates as cycle_length - 14.'),
}).custom((value, helpers) => {
  const start = new Date(value.period_start_date);
  const end   = new Date(value.period_end_date);
  if (end < start) {
    return helpers.error('any.custom', { message: 'period_end_date must be after period_start_date' });
  }
  return value;
}).messages({
  'any.custom': 'period_end_date must be after period_start_date'
});

const cycleLogsSchema = Joi.object({
  cycles: Joi.array().items(cycleEntrySchema).min(1).required()
    .description('Array of cycle log objects. One object per menstrual cycle. Minimum 1 required.'),
  rppg_ovulation_day: Joi.number().integer().min(1).max(35).allow(null).default(null)
    .description('Optional: ovulation day detected by rPPG or wearable sensor (day of cycle). If null, server estimates as cycle_length - 14.'),
});

function validate(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, { abortEarly: false });
    
    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));
      
      return res.status(422).json({
        success: false,
        status: 422,
        message: 'Validation failed',
        errors,
        meta: {
          request_id: req.requestId,
          timestamp: new Date().toISOString()
        }
      });
    }
    
    req.body = value;
    next();
  };
}

module.exports = {
  aggregatedSchema,
  cycleEntrySchema,
  cycleLogsSchema,
  validate
};
