// 休暇申請 API
//  GET   /api/leave-requests?employee_id=     休暇申請一覧（employee_id は任意）
//  POST  /api/leave-requests                  休暇申請（body: employee_id, leave_date, reason）
//  PATCH /api/leave-requests/:id/status       ステータス変更（body: status）
const express = require('express');
const pool = require('../db/pool');
const {
  HttpError,
  parseId,
  validateLeaveReason,
  LEAVE_STATUSES,
} = require('../utils/validation');
const { isValidDateString, isWeekday } = require('../utils/date');

const router = express.Router();

const COLUMNS = 'id, employee_id, leave_date, reason, status, created_at, updated_at';

// 休暇申請一覧（社員名も一緒に返す。休暇一覧画面で表示するため）
router.get('/', async (req, res, next) => {
  try {
    const rawEmployeeId = req.query.employee_id;

    if (rawEmployeeId === undefined || rawEmployeeId === '') {
      // 絞り込みなし: 全件
      const { rows } = await pool.query(
        `SELECT lr.id, lr.employee_id, e.name AS employee_name, lr.leave_date, lr.reason,
                lr.status, lr.created_at, lr.updated_at
           FROM leave_requests lr
           JOIN employees e ON e.id = lr.employee_id
          ORDER BY lr.leave_date DESC, lr.id DESC`
      );
      return res.status(200).json(rows);
    }

    const employeeId = parseId(rawEmployeeId);
    if (employeeId === null) {
      throw new HttpError(400, 'employee_id が不正です');
    }
    const employee = await pool.query('SELECT 1 FROM employees WHERE id = $1', [employeeId]);
    if (employee.rowCount === 0) {
      throw new HttpError(404, '社員が見つかりません');
    }
    const { rows } = await pool.query(
      `SELECT lr.id, lr.employee_id, e.name AS employee_name, lr.leave_date, lr.reason,
              lr.status, lr.created_at, lr.updated_at
         FROM leave_requests lr
         JOIN employees e ON e.id = lr.employee_id
        WHERE lr.employee_id = $1
        ORDER BY lr.leave_date DESC, lr.id DESC`,
      [employeeId]
    );
    return res.status(200).json(rows);
  } catch (err) {
    return next(err);
  }
});

// 休暇申請
// 登録時のステータスは必ず pending（DB の DEFAULT に任せ、body の status は受け付けない）。
// 重複申請は UNIQUE (employee_id, leave_date) 違反（23505）で 409、存在しない社員は 23503 で 404。
router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};

    if (body.employee_id === undefined || body.employee_id === null || body.employee_id === '') {
      throw new HttpError(400, 'employee_id は必須です');
    }
    const employeeId = parseId(body.employee_id);
    if (employeeId === null) {
      throw new HttpError(400, 'employee_id が不正です');
    }

    if (body.leave_date === undefined || body.leave_date === null || body.leave_date === '') {
      throw new HttpError(400, 'leave_date は必須です');
    }
    if (!isValidDateString(body.leave_date)) {
      throw new HttpError(400, 'leave_date は YYYY-MM-DD 形式の正しい日付で指定してください');
    }
    // 平日のみ申請できる（過去の日付は可）
    if (!isWeekday(body.leave_date)) {
      throw new HttpError(400, '休暇は平日のみ申請できます');
    }

    // 理由は任意。空文字・空白のみは NULL として保存する（500文字まで・制御文字は不可）
    const reason = validateLeaveReason(body.reason);

    const { rows } = await pool.query(
      `INSERT INTO leave_requests (employee_id, leave_date, reason)
       VALUES ($1, $2, $3)
       RETURNING ${COLUMNS}`,
      [employeeId, body.leave_date, reason]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

// ステータス変更（どの状態からどの状態へも変更できる）
router.patch('/:id/status', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      throw new HttpError(400, '休暇申請IDが不正です');
    }
    const body = req.body || {};
    if (!LEAVE_STATUSES.includes(body.status)) {
      throw new HttpError(400, `status は ${LEAVE_STATUSES.join(' / ')} のいずれかを指定してください`);
    }

    const { rows, rowCount } = await pool.query(
      `UPDATE leave_requests
          SET status = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING ${COLUMNS}`,
      [body.status, id]
    );
    if (rowCount === 0) {
      throw new HttpError(404, '休暇申請が見つかりません');
    }
    return res.status(200).json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
