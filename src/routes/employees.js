// 社員 API
//  GET    /api/employees              社員一覧
//  POST   /api/employees              社員登録
//  DELETE /api/employees/:id          社員削除（打刻・休暇は ON DELETE CASCADE で削除）
//  GET    /api/employees/:id/summary  月次集計（?month=YYYY-MM、省略時は当月）
const express = require('express');
const pool = require('../db/pool');
const { HttpError, parseId, validateEmployeeName } = require('../utils/validation');
const {
  getTokyoDateString,
  getMonthRange,
  isValidMonthString,
} = require('../utils/date');
const { calculateMonthlySummary } = require('../utils/summary');

const router = express.Router();

// 社員一覧
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, created_at FROM employees ORDER BY id'
    );
    res.status(200).json(rows);
  } catch (err) {
    next(err);
  }
});

// 社員登録
router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const name = validateEmployeeName(body.name);
    const { rows } = await pool.query(
      'INSERT INTO employees (name) VALUES ($1) RETURNING id, name, created_at',
      [name]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// 社員削除
router.delete('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      throw new HttpError(400, '社員IDが不正です');
    }
    const { rowCount } = await pool.query('DELETE FROM employees WHERE id = $1', [id]);
    if (rowCount === 0) {
      throw new HttpError(404, '社員が見つかりません');
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// 月次集計
router.get('/:id/summary', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      throw new HttpError(400, '社員IDが不正です');
    }

    // 「今日」と「当月」は日本時間で決める
    const today = getTokyoDateString();
    let month = req.query.month;
    if (month === undefined || month === '') {
      month = today.slice(0, 7);
    } else if (!isValidMonthString(month)) {
      throw new HttpError(400, 'month は YYYY-MM 形式で指定してください');
    }

    // 登録日は created_at を日本時間に変換した日付（サーバーや DB の TZ 設定に依存しない）
    const employeeResult = await pool.query(
      `SELECT id, name, (created_at AT TIME ZONE 'Asia/Tokyo')::date AS registration_date
         FROM employees
        WHERE id = $1`,
      [id]
    );
    if (employeeResult.rowCount === 0) {
      throw new HttpError(404, '社員が見つかりません');
    }
    const employee = employeeResult.rows[0];

    const { first, last } = getMonthRange(month);
    const [attendanceResult, leaveResult] = await Promise.all([
      pool.query(
        `SELECT work_date, clock_in, clock_out
           FROM attendances
          WHERE employee_id = $1 AND work_date BETWEEN $2 AND $3`,
        [id, first, last]
      ),
      pool.query(
        `SELECT leave_date
           FROM leave_requests
          WHERE employee_id = $1 AND status = 'approved' AND leave_date BETWEEN $2 AND $3`,
        [id, first, last]
      ),
    ]);

    const summary = calculateMonthlySummary({
      month,
      today,
      registrationDate: employee.registration_date,
      attendances: attendanceResult.rows,
      approvedLeaveDates: leaveResult.rows.map((r) => r.leave_date),
    });

    res.status(200).json({
      employee_id: employee.id,
      employee_name: employee.name,
      ...summary,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
