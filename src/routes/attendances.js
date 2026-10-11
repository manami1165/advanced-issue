// 打刻 API
//  POST /api/attendances/clock-in   出勤打刻（body: employee_id）
//  POST /api/attendances/clock-out  退勤打刻（body: employee_id）
//  GET  /api/attendances?employee_id=&month=YYYY-MM  打刻一覧
const express = require('express');
const pool = require('../db/pool');
const { HttpError, parseId } = require('../utils/validation');
const {
  getTokyoDateString,
  addDays,
  getMonthRange,
  isValidMonthString,
} = require('../utils/date');

const router = express.Router();

const COLUMNS = 'id, employee_id, work_date, clock_in, clock_out, created_at';

// body の employee_id を検証する
function getEmployeeIdFromBody(req) {
  const body = req.body || {};
  if (body.employee_id === undefined || body.employee_id === null || body.employee_id === '') {
    throw new HttpError(400, 'employee_id は必須です');
  }
  const employeeId = parseId(body.employee_id);
  if (employeeId === null) {
    throw new HttpError(400, 'employee_id が不正です');
  }
  return employeeId;
}

// 社員の存在確認（いなければ 404）
async function assertEmployeeExists(employeeId) {
  const { rowCount } = await pool.query('SELECT 1 FROM employees WHERE id = $1', [employeeId]);
  if (rowCount === 0) {
    throw new HttpError(404, '社員が見つかりません');
  }
}

// 出勤打刻
// work_date は日本時間の今日。二重打刻は UNIQUE (employee_id, work_date) 違反（23505）で 409 にする。
// 事前 SELECT はせず、INSERT の制約違反で判定するので同時押しでも 1 件しか入らない。
// 存在しない社員は外部キー違反（23503）で 404 にする。
router.post('/clock-in', async (req, res, next) => {
  try {
    const employeeId = getEmployeeIdFromBody(req);
    const workDate = getTokyoDateString();
    const { rows } = await pool.query(
      `INSERT INTO attendances (employee_id, work_date, clock_in)
       VALUES ($1, $2, NOW())
       RETURNING ${COLUMNS}`,
      [employeeId, workDate]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// 退勤打刻
// 1. 今日（日本時間）の未退勤の打刻を退勤済みにする
// 2. 今日の打刻があるがすでに退勤済みなら 409
// 3. 今日の打刻がなければ、前日の未退勤の打刻を退勤済みにする（日をまたいだ退勤。勤務は出勤日の扱い）
// 4. どれにも当たらなければ 400「出勤打刻がありません」
// UPDATE の条件に clock_out IS NULL を入れているので、同時押しでも退勤時刻は1回しか書かれない。
router.post('/clock-out', async (req, res, next) => {
  try {
    const employeeId = getEmployeeIdFromBody(req);
    await assertEmployeeExists(employeeId);

    const today = getTokyoDateString();
    const updateSql = `UPDATE attendances
                          SET clock_out = NOW()
                        WHERE employee_id = $1 AND work_date = $2 AND clock_out IS NULL
                        RETURNING ${COLUMNS}`;

    // 1. 今日の打刻を退勤
    const todayUpdate = await pool.query(updateSql, [employeeId, today]);
    if (todayUpdate.rowCount > 0) {
      return res.status(200).json(todayUpdate.rows[0]);
    }

    // 2. 今日の打刻があれば、すでに退勤済み
    const todayRecord = await pool.query(
      'SELECT 1 FROM attendances WHERE employee_id = $1 AND work_date = $2',
      [employeeId, today]
    );
    if (todayRecord.rowCount > 0) {
      throw new HttpError(409, 'すでに退勤済みです');
    }

    // 3. 前日から日をまたいでいる未退勤の打刻を退勤
    const yesterdayUpdate = await pool.query(updateSql, [employeeId, addDays(today, -1)]);
    if (yesterdayUpdate.rowCount > 0) {
      return res.status(200).json(yesterdayUpdate.rows[0]);
    }

    // 4. 出勤していない
    throw new HttpError(400, '出勤打刻がありません');
  } catch (err) {
    next(err);
  }
});

// 打刻一覧（employee_id は必須、month は省略時に当月）
router.get('/', async (req, res, next) => {
  try {
    const { employee_id: rawEmployeeId, month: rawMonth } = req.query;
    if (rawEmployeeId === undefined || rawEmployeeId === '') {
      throw new HttpError(400, 'employee_id は必須です');
    }
    const employeeId = parseId(rawEmployeeId);
    if (employeeId === null) {
      throw new HttpError(400, 'employee_id が不正です');
    }

    let month = rawMonth;
    if (month === undefined || month === '') {
      month = getTokyoDateString().slice(0, 7);
    } else if (!isValidMonthString(month)) {
      throw new HttpError(400, 'month は YYYY-MM 形式で指定してください');
    }

    await assertEmployeeExists(employeeId);

    const { first, last } = getMonthRange(month);
    const { rows } = await pool.query(
      `SELECT ${COLUMNS}
         FROM attendances
        WHERE employee_id = $1 AND work_date BETWEEN $2 AND $3
        ORDER BY work_date`,
      [employeeId, first, last]
    );
    res.status(200).json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
