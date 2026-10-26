import {
  appliedAtFromRow,
  normalizeAppliedAt,
  normalizeStatus,
  type RemoteApplication,
} from '../shared/model.js';

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as ObjectValue)
    : null;
}
function string(value: unknown): string {
  if (typeof value === 'string') return normalizeStatus(value);
  const item = object(value);
  if (item) return string(item.zh ?? item.zh_cn ?? item['zh-CN'] ?? item.i18n ?? item.name);
  return '';
}
function statusText(value: unknown) {
  const text = string(value);
  return /^\d+$/.test(text) ? '' : text;
}
function identifier(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
/** Titles copied from join.qq.com progress page. Step ids are the page's own interviewFormText list. */
const tencentInterviewSteps: Record<number, string> = {
  1: '集体面试',
  2: '初试',
  3: '复试',
  5: 'HR面试',
  200: '用人决策者面试',
};
function tencentProgressStatus(row: ObjectValue) {
  const current = object(row.currentStatus);
  const assessment = object(row.assessmentInfo);
  if (!current) return '';
  if (current.status === 4) return '前序流程已结束，期待新流程再会';
  if (current.applyProcessType === 5) {
    const statusId = string(object(row.campusRecruitThree)?.statusId);
    return statusId === '300' || statusId === '301' ? '三方已签约' : '三方签约中';
  }
  const offer = object(current.profileTwo);
  if (current.applyProcessType === 2 && offer?.stepId === 1) return '录用评估中';
  if (current.applyProcessType === 2 && offer?.stepId === 2)
    return offer.id === 25 ? '意向签约' : '确认意向书';
  if (current.applyProcessType === 2 && offer?.stepId === 3) return '确认OFFER';
  const interview = object(current.profileOne);
  if (
    current.applyProcessType === 1 &&
    typeof interview?.stepId === 'number' &&
    tencentInterviewSteps[interview.stepId]
  )
    return tencentInterviewSteps[interview.stepId];
  if (assessment?.status === 2 || assessment?.status === 6) return '简历投递成功，请及时完成测评';
  if (assessment?.status === 5) return '测评失效';
  if (assessment?.status === 7) return '简历投递成功，测评通知发送失败';
  if (assessment?.status === 3) return '简历筛选中';
  if (current.applyProcessType === 3 || assessment?.status === 0)
    return '简历投递成功，请保持联系方式畅通';
  const written = object(row.currentWrittenTest);
  const writtenTitle = statusText(written?.testType);
  if (writtenTitle && current.status !== 4 && string(written?.linkAddr)) return writtenTitle;
  return '';
}
function lenovoNodeName(status: number) {
  if (status === 1) return 'deliveryNodeVo';
  if (status === 2 || status === 3) return 'examineNodeVo';
  if (status >= 4 && status <= 8) return 'interviewNodeVo';
  if (status >= 9 && status <= 11) return 'offerNodeVo';
  return '';
}
/** Card title from talent.lenovo.com.cn apply page. The numeric node only selects that public title. */
function lenovoProgressStatus(row: ObjectValue) {
  const nodeVo = object(row.nodeVo);
  if (!nodeVo || typeof nodeVo.status !== 'number') return '';
  const projectType = typeof row.projectType === 'number' ? row.projectType : 0;
  const name = lenovoNodeName(nodeVo.status);
  if (!name) return '';
  const node = object(nodeVo[name]) ?? {};
  if (nodeVo.end === 1) {
    const last = object(
      (Array.isArray(node.backVoList) ? node.backVoList : []).at(-1),
    );
    if (name === 'offerNodeVo' && projectType === 1 && last?.offerStatus === 4)
      return '您已拒绝offer，流程结束';
    if (Array.isArray(node.afterJobId) && node.afterJobId.length > 0) return '流程结束(已调剂)';
    return '流程结束';
  }
  if (name === 'deliveryNodeVo') return '投递成功';
  if (name === 'examineNodeVo') {
    if (node.status === 2) return '测评已完成';
    if (Array.isArray(node.queues) && node.queues.length > 0) return '测评待完成';
  } else if (name === 'interviewNodeVo') {
    if (projectType !== 3) {
      const interviews = Array.isArray(node.interviewList) ? [...node.interviewList].reverse() : [];
      for (const value of interviews) {
        const interview = object(value);
        if (!interview) continue;
        if (interview.status === 3) return '面试已结束';
        if (interview.status === 4 || interview.isRefuse === true) return '面试已拒绝';
        if (interview.messages) return '面试待完成';
        if (interview.queues) return '面试待预约';
      }
    }
  } else if (node.status === 1) return 'Offer意向待反馈';
  else if (node.status === 2 || node.status === 3) {
    const backs = Array.isArray(node.backVoList) ? [...node.backVoList].reverse() : [];
    for (const value of backs) {
      const back = object(value);
      if (!back) continue;
      if (back.offerStatus === 2 || back.offerStatus === 3) return 'Offer意向已反馈';
      if (back.offerStatus === 11) return '欢迎加入联想!';
    }
    return 'Offer意向待反馈';
  }
  if (projectType === 3 && nodeVo.status >= 4 && nodeVo.status <= 7) return '评估中';
  if (nodeVo.status === 6) return '面试已结束';
  if (nodeVo.status === 7) return '面试已拒绝';
  if (nodeVo.status === 8) return '评估中';
  if (nodeVo.status === 11) return '欢迎加入联想!';
  if (name === 'examineNodeVo') return '测评';
  if (name === 'interviewNodeVo') return '面试';
  if (name === 'offerNodeVo') return 'Offer';
  return '';
}

/** Fields confirmed against the public Feishu career site's own application-page bundle. */
export function parseFeishuPayloads(
  payloads: unknown[],
  visibleStatuses: RemoteApplication[] = [],
): RemoteApplication[] {
  const stageNames = new Map<string, string>();
  const deliveries: ObjectValue[] = [];
  for (const payload of payloads) {
    const root = object(payload);
    const data = object(root?.data);
    if (!data || (root?.code !== undefined && root.code !== 0)) continue;
    if (Array.isArray(data.stage_list))
      for (const value of data.stage_list) {
        const stage = object(value);
        if (stage) stageNames.set(identifier(stage.id), string(stage.name));
      }
    if (Array.isArray(data.delivery_list))
      for (const value of data.delivery_list) {
        const row = object(value);
        if (row) deliveries.push(row);
      }
  }
  const result: RemoteApplication[] = [];
  for (const row of deliveries) {
    const job = object(row.job_post_info);
    const stage = object(row.current_stage);
    const title = string(job?.title);
    const subTitle = string(job?.sub_title);
    const position = subTitle ? `${title} - ${subTitle}` : title;
    const project = object(job?.job_subject);
    const recruitType = object(job?.recruit_type);
    const batch = string(project?.name) || string(recruitType?.name);
    // 某些公司只公开操作日志，current_stage 固定为 0。读取该岗位卡片真实显示的最后一步。
    const visibleMatches = visibleStatuses.filter(
      (item) => item.position === position && (!item.batch || !batch || item.batch === batch),
    );
    const rawStatus =
      string(stage?.stage_name ?? stage?.name) ||
      stageNames.get(identifier(stage?.stage_id)) ||
      (visibleMatches.length === 1 ? visibleMatches[0].rawStatus : '');
    const id = identifier(row.application_id) || identifier(row.id);
    if (!position || !id || rawStatus.length > 200) continue;
    const appliedAt = appliedAtFromRow(row);
    result.push({ id, position, batch, rawStatus, ...(appliedAt ? { appliedAt } : {}) });
  }
  return deduplicate(result);
}

/** Moka variants only accept explicit textual statuses on application objects; never infer numeric status codes. */
export function parseMokaPayloads(
  payloads: unknown[],
  visible: RemoteApplication[] = [],
): RemoteApplication[] {
  return parseSitePayloads(payloads, 'moka', visible);
}
/** Only explicit application identifiers and public textual progress are accepted.
 * Numeric internal stage codes are deliberately never translated into hiring statuses. */
export function parseSitePayloads(
  payloads: unknown[],
  site: string,
  visible: RemoteApplication[] = [],
): RemoteApplication[] {
  const result: RemoteApplication[] = [];
  const huaweiStages = new Map<string, string>();
  if (site === 'career.huawei.com')
    for (const payload of payloads) {
      const root = object(payload);
      const id = identifier(root?.__awaitofferApplicationId);
      if (!id || root?.status !== 'SUCCESS' || !Array.isArray(root.data)) continue;
      const rows = root.data
        .map(object)
        .filter(
          (row): row is ObjectValue =>
            !!row && !!string(row.processName) && !!statusText(row.processStatusName),
        );
      const current =
        rows.find((r) =>
          /进行中|处理中|待处理|未通过|不通过|失败|终止/.test(string(r.processStatusName)),
        ) ??
        rows.filter((r) => /通过|完成|结束/.test(string(r.processStatusName))).at(-1) ??
        rows[0];
      if (current)
        huaweiStages.set(
          id,
          `${string(current.processName)} - ${string(current.processStatusName)}`,
        );
    }
  const visit = (value: unknown, depth: number) => {
    if (depth > 10) return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 1000)) visit(item, depth + 1);
      return;
    }
    const row = object(value);
    if (!row) return;
    if (typeof row.body === 'string') {
      const trimmed = row.body.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          visit(JSON.parse(trimmed), depth + 1);
        } catch {
          /* 字符串正文不是投递 JSON */
        }
      }
    }
    const job =
      object(row.job) ?? object(row.position) ?? object(row.jobInfo) ?? object(row.positionInfo);
    const beisenDelivery =
      (site === 'we.zyt.com' || site.endsWith('.zhiye.com') || site === 'hr-campus.vivo.com') &&
      typeof row.JobAdTitle === 'string' &&
      ('DeliveryStatus' in row || 'DeliveryDate' in row);
    const huaweiDelivery =
      site === 'career.huawei.com' &&
      typeof row.applicationProfileId === 'number' &&
      typeof row.positionExternalName === 'string';
    const aliDelivery =
      site === 'campus-talent.alibaba.com' &&
      typeof row.applyNumber === 'string' &&
      typeof row.position === 'string' &&
      typeof row.batchName === 'string';
    const mokaDelivery =
      site === 'moka' && typeof row.jobTitle === 'string' && typeof row.deliverTime === 'string';
    const honorDelivery =
      site === 'career.honor.com' &&
      typeof row.postName === 'string' &&
      ('deliverStatus' in row || 'deliveryFlowShowVOs' in row);
    // Field names and textual step labels used by the site's public personal-center bundle.
    const baiduDelivery =
      site === 'talent.baidu.com' &&
      typeof row.postName === 'string' &&
      Array.isArray(row.applyProcessStatusDTOList) &&
      typeof row.resumeType === 'string';
    const jdDelivery =
      site === 'campus.jd.com' &&
      typeof row.positionName === 'string' &&
      !!object(row.positionDetailVo) &&
      Array.isArray(row.nodeList);
    const kuaishouDelivery =
      site === 'campus.kuaishou.cn' &&
      typeof row.applyPositionName === 'string' &&
      (typeof row.applyCode === 'string' || typeof row.applyPositionId === 'number');
    const tencentInfo = object(row.positionInfo);
    const tencentDelivery =
      site === 'join.qq.com' &&
      typeof tencentInfo?.applyPositionTxt === 'string' &&
      !!object(row.currentStatus);
    const tencentPosition = tencentDelivery
      ? [string(tencentInfo?.applyPositionTxt), string(tencentInfo?.subDirectionIdTxt)]
          .filter(Boolean)
          .join('-')
      : '';
    const lenovoDelivery =
      site === 'talent.lenovo.com.cn' &&
      typeof row.jobName === 'string' &&
      typeof object(row.nodeVo)?.status === 'number';
    const id =
      identifier(
        row.applicationId ??
          row.application_id ??
          row.applyId ??
          row.deliveryId ??
          row.deliverId ??
          row.applicationID ??
          row.applyRecordId ??
          (honorDelivery || baiduDelivery || jdDelivery ? row.id : undefined) ??
          (huaweiDelivery ? row.applicationProfileId : undefined) ??
          (aliDelivery ? row.applyNumber : undefined) ??
          (beisenDelivery ? (row.ApplyId ?? row.Id) : undefined) ??
          (kuaishouDelivery ? (row.applyCode ?? row.applyPositionId) : undefined) ??
          (tencentDelivery
            ? (row.resumeId ?? tencentInfo?.recruitPostId ?? tencentInfo?.positionId)
            : undefined) ??
          (lenovoDelivery ? (row.myJobId ?? row.jid ?? row.id) : undefined),
      ) ||
      (tencentDelivery && tencentPosition ? `qq:${tencentPosition}` : '') ||
      (mokaDelivery ? `moka-delivery:${JSON.stringify([row.jobTitle, row.deliverTime])}` : '');
    const position = tencentDelivery
      ? tencentPosition
      : string(
      row.jobName ??
        row.positionName ??
        row.postName ??
        (mokaDelivery ? row.jobTitle : undefined) ??
        (huaweiDelivery ? row.externalJobName || row.positionExternalName : undefined) ??
        (aliDelivery ? row.position : undefined) ??
        (beisenDelivery ? row.JobAdTitle : undefined) ??
        (kuaishouDelivery ? row.applyPositionName : undefined) ??
        (lenovoDelivery ? row.jobName : undefined) ??
        job?.title ??
        job?.name,
    );
    const batch =
      string(
        row.projectName ??
          row.recruitmentName ??
          row.batchName ??
          row.projectTitle ??
          (huaweiDelivery ? row.recruitSceneName : undefined) ??
          (beisenDelivery ? row.CategoryName : undefined) ??
          (lenovoDelivery ? row.projectTypeText : undefined),
      ) ||
      (baiduDelivery && row.resumeType === 'GRADUATE' ? '校园招聘' : '') ||
      (jdDelivery ? string(object(row.reJobObjective)?.planName) : '');
    const baiduSteps = baiduDelivery
      ? (row.applyProcessStatusDTOList as unknown[])
          .map(object)
          .filter((step): step is ObjectValue => !!step)
      : [];
    // DONE=1, WAIT=0, STOP=-1 and PROCESS=2 are the site's own enum. Read the actual display label.
    const baiduCurrent =
      baiduSteps.find((step) => step.finishFlag === 2 || step.finishFlag === -1) ??
      baiduSteps.filter((step) => step.finishFlag === 1).at(-1);
    const baiduStatus = baiduDelivery
      ? string(row.stopTips) ||
        (baiduCurrent && statusText(baiduCurrent.officialFinishName)
          ? `${string(baiduCurrent.officialName)} - ${statusText(baiduCurrent.officialFinishName)}`
          : statusText(row.statusName))
      : '';
    const matches = visible.filter(
      (i) => i.position === position && (!batch || !i.batch || batch === i.batch),
    );
    const rawStatus = tencentDelivery
      ? tencentProgressStatus(row)
      : lenovoDelivery
        ? lenovoProgressStatus(row)
        : (huaweiDelivery ? huaweiStages.get(id) : '') ||
          baiduStatus ||
          statusText(
        row.statusName ??
          row.stageName ??
          row.progressName ??
          row.currentStageName ??
          row.statusText ??
          row.applyStatusName ??
          (huaweiDelivery ? row.applicationStatus : undefined) ??
          (aliDelivery ? row.status : undefined) ??
          (mokaDelivery ? row.stage : undefined) ??
          (jdDelivery ? row.status : undefined) ??
          (beisenDelivery ? row.DeliveryStatus : undefined) ??
          (kuaishouDelivery
            ? (row.applyStageName ?? row.stageName ?? row.currentStatus)
            : undefined),
      ) ||
      (kuaishouDelivery && row.ifArchive === true ? '已结束' : '') ||
      (kuaishouDelivery && /[一-鿿]/.test(string(row.applyStageCode))
        ? string(row.applyStageCode)
        : '') ||
      (kuaishouDelivery ? '已投递' : '') ||
      (matches.length === 1 ? matches[0].rawStatus : '');
    const appliedAt = appliedAtFromRow(row);
    if (id && position && rawStatus.length <= 200)
      result.push({
        id,
        position,
        rawStatus,
        batch,
        ...(appliedAt ? { appliedAt } : {}),
        ...(mokaDelivery && string(row.commitment)
          ? { recruitmentType: string(row.commitment) }
          : {}),
        ...(baiduDelivery
          ? {
              recruitmentType:
                row.resumeType === 'SOCIAL'
                  ? '社会招聘'
                  : row.resumeType === 'INTERN'
                    ? '实习'
                    : row.resumeType === 'GRADUATE'
                      ? '校园招聘'
                      : '',
            }
          : {}),
      });
    for (const item of Object.values(row))
      if (item && typeof item === 'object') visit(item, depth + 1);
  };
  for (const payload of payloads) visit(payload, 0);
  return deduplicate(result);
}
export function deduplicate(items: RemoteApplication[]) {
  const unique = new Map<string, RemoteApplication>();
  const conflicting = new Set<string>();
  for (const item of items) {
    const previous = unique.get(item.id);
    if (previous && (previous.position !== item.position || previous.rawStatus !== item.rawStatus))
      conflicting.add(item.id);
    unique.set(item.id, item);
  }
  return [...unique.values()].filter((item) => !conflicting.has(item.id));
}

const clockPositionKeys = ['position', 'postName', 'jobName', 'positionName', 'jobTitle', 'JobAdTitle'];
/** A delivery clock sitting on the same object as the position, when that pair is unique. */
export function deliveryClocks(payloads: unknown[]) {
  const found = new Map<string, Set<string>>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 8) return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 1000)) visit(item, depth + 1);
      return;
    }
    const row = object(value);
    if (!row) return;
    const position = clockPositionKeys.map((key) => string(row[key])).find(Boolean) ?? '';
    const appliedAt = appliedAtFromRow(row);
    if (position && appliedAt) {
      const times = found.get(position) ?? new Set<string>();
      times.add(appliedAt);
      found.set(position, times);
    }
    for (const item of Object.values(row))
      if (item && typeof item === 'object') visit(item, depth + 1);
  };
  for (const payload of payloads) visit(payload, 0);
  const unique = new Map<string, string>();
  for (const [position, times] of found) if (times.size === 1) unique.set(position, [...times][0]);
  return unique;
}
export function parseMihoyoRows(rows: { id: string | null; cells: string[] }[]) {
  return deduplicate(
    rows.flatMap((row) => {
      if (!row.id || row.cells.length < 6) return [];
      const lines = row.cells[0]
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const [position, ...batch] = lines;
      const rawStatus = normalizeStatus(row.cells[5]);
      const appliedAt = normalizeAppliedAt(row.cells[4]);
      if (!position || !rawStatus || rawStatus.length > 200) return [];
      return [
        {
          id: row.id,
          position,
          batch: batch.join(' '),
          rawStatus,
          recruitmentType: row.cells[3],
          ...(appliedAt ? { appliedAt } : {}),
        },
      ];
    }),
  );
}
