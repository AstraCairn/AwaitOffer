import { describe, expect, it } from 'vitest';
import {
  deliveryClocks,
  parseFeishuPayloads,
  parseMokaPayloads,
  parseSitePayloads,
  parseMihoyoRows,
} from './adapters.js';
import { parseBookmarks } from './bookmarks.js';
import { sanitizeRecruitmentUrl } from '../shared/model.js';

describe('conservative recruitment adapters', () => {
  it('reads Baidu application ids and the current public step without treating future steps as progress', () => {
    expect(
      parseSitePayloads(
        [
          {
            data: [
              {
                id: 'baidu-application',
                postName: 'AI研发工程师',
                resumeType: 'GRADUATE',
                applyProcessStatusDTOList: [
                  { officialName: '投递简历', officialFinishName: '已完成', finishFlag: 1 },
                  { officialName: '简历筛选', officialFinishName: '简历筛选中', finishFlag: 2 },
                  { officialName: '面试', officialFinishName: '', finishFlag: 0 },
                ],
              },
            ],
          },
        ],
        'talent.baidu.com',
      ),
    ).toEqual([
      {
        id: 'baidu-application',
        position: 'AI研发工程师',
        batch: '校园招聘',
        rawStatus: '简历筛选 - 简历筛选中',
        recruitmentType: '校园招聘',
      },
    ]);
    expect(
      parseSitePayloads(
        [
          {
            data: [
              {
                id: 'baidu-dated',
                postName: 'AI研发工程师',
                resumeType: 'GRADUATE',
                submitDate: '2026-10-12',
                applyProcessStatusDTOList: [
                  { officialName: '简历筛选', officialFinishName: '简历筛选中', finishFlag: 2 },
                ],
              },
            ],
          },
        ],
        'talent.baidu.com',
      )[0].appliedAt,
    ).toBe('2026-10-12');
  });
  it('keeps Baidu social and internship records explicitly labelled for import filtering', () => {
    const apps = parseSitePayloads(
      [
        {
          data: [
            {
              id: 'social',
              postName: 'Agent工程师',
              resumeType: 'SOCIAL',
              stopTips: '流程已结束，简历共享中',
              applyProcessStatusDTOList: [],
            },
            {
              id: 'intern',
              postName: '研发工程师',
              resumeType: 'INTERN',
              statusName: '初筛',
              applyProcessStatusDTOList: [],
            },
          ],
        },
      ],
      'talent.baidu.com',
    );
    expect(apps[0].rawStatus).toBe('流程已结束，简历共享中');
    expect(apps.map((a) => a.recruitmentType)).toEqual(['社会招聘', '实习']);
  });
  it('reads a Kuaishou application list even when the stage is only a code', () => {
    expect(
      parseSitePayloads(
        [
          {
            code: 0,
            result: {
              list: [
                {
                  applyCode: 'KS-1',
                  applyPositionName: '后端开发工程师',
                  applyStageCode: 'SCREEN',
                  writeExam: false,
                  ifArchive: false,
                },
              ],
            },
          },
        ],
        'campus.kuaishou.cn',
      ),
    ).toEqual([
      { id: 'KS-1', position: '后端开发工程师', batch: '', rawStatus: '已投递' },
    ]);
    expect(
      parseSitePayloads(
        [
          {
            result: {
              list: [
                {
                  applyCode: 'KS-2',
                  applyPositionName: '算法工程师',
                  applyStageCode: 'HR初筛',
                  ifArchive: false,
                },
                {
                  applyCode: 'KS-3',
                  applyPositionName: '算法工程师',
                  applyStageCode: '面试',
                  ifArchive: true,
                },
              ],
            },
          },
        ],
        'campus.kuaishou.cn',
      ).map((item) => item.rawStatus),
    ).toEqual(['HR初筛', '已结束']);
  });
  it('reads Tencent progress with the same title the progress page shows', () => {
    expect(
      parseSitePayloads(
        [
          {
            data: {
              status: 0,
              data: {
                resumeId: 'resume-1',
                positionInfo: { applyPositionTxt: '后台开发', subDirectionIdTxt: '深圳' },
                currentStatus: { applyProcessType: 4, status: 1 },
                assessmentInfo: { status: 3 },
              },
            },
          },
        ],
        'join.qq.com',
      ),
    ).toEqual([
      { id: 'resume-1', position: '后台开发-深圳', batch: '', rawStatus: '简历筛选中' },
    ]);
    expect(
      parseSitePayloads(
        [
          {
            data: {
              positionInfo: { applyPositionTxt: '客户端开发' },
              currentStatus: { applyProcessType: 4, status: 1 },
              assessmentInfo: { status: 2 },
            },
          },
        ],
        'join.qq.com',
      )[0].rawStatus,
    ).toBe('简历投递成功，请及时完成测评');
    expect(
      parseSitePayloads(
        [
          {
            data: {
              positionInfo: { applyPositionTxt: '客户端开发' },
              currentStatus: { applyProcessType: 1, status: 1, profileOne: { stepId: 2 } },
              assessmentInfo: { status: 3 },
            },
          },
        ],
        'join.qq.com',
      )[0].rawStatus,
    ).toBe('初试');
    expect(
      parseSitePayloads(
        [{ data: { assessmentInfo: { status: 3 }, currentStatus: { status: 9 } } }],
        'join.qq.com',
      ),
    ).toEqual([]);
  });
  it('reads Lenovo card titles and does not turn a numeric result into a stage', () => {
    expect(
      parseSitePayloads(
        [
          {
            code: 0,
            result: [
              {
                myJobId: 88,
                jobName: '软件开发工程师',
                projectType: 1,
                projectTypeText: '校园招聘',
                nodeVo: { status: 1, end: 0, deliveryNodeVo: { result: 0, status: 1 } },
              },
            ],
          },
        ],
        'talent.lenovo.com.cn',
      ),
    ).toEqual([
      { id: '88', position: '软件开发工程师', batch: '校园招聘', rawStatus: '投递成功' },
    ]);
    expect(
      parseSitePayloads(
        [
          {
            myJobId: 'exam-1',
            jobName: '算法工程师',
            projectType: 1,
            nodeVo: { status: 2, examineNodeVo: { status: 2, result: 1 } },
          },
        ],
        'talent.lenovo.com.cn',
      )[0].rawStatus,
    ).toBe('测评已完成');
    expect(
      parseSitePayloads(
        [{ jobName: '算法工程师', result: 1, status: 2 }],
        'talent.lenovo.com.cn',
      ),
    ).toEqual([]);
  });
  it('reads JD delivery ids and literal current status from delivery records', () => {
    expect(
      parseSitePayloads(
        [
          {
            body: [
              {
                id: 'jd-delivery',
                positionName: '后端开发工程师',
                status: '笔试中',
                statusCode: 'WRITTEN',
                nodeList: [
                  { name: '笔试', status: 'WRITTEN' },
                  { name: 'Offer', status: 'OFFER' },
                ],
                positionDetailVo: { publishId: 'job-id' },
                reJobObjective: { planName: '2027 JDS' },
              },
            ],
          },
        ],
        'campus.jd.com',
      ),
    ).toEqual([
      { id: 'jd-delivery', position: '后端开发工程师', batch: '2027 JDS', rawStatus: '笔试中' },
    ]);
    expect(
      parseSitePayloads(
        [{ id: 'job-id', positionName: '后端开发工程师', status: '发布中' }],
        'campus.jd.com',
      ),
    ).toEqual([]);
  });
  it('reads a unique position delivery clock without using a second conflicting time', () => {
    expect(
      deliveryClocks([
        {
          content: [
            {
              applications: [
                { position: 'Agent开发工程师', applyTime: '2026-10-14 09:20', status: '新投递' },
              ],
            },
          ],
        },
      ]).get('Agent开发工程师'),
    ).toBe('2026-10-14 09:20');
    expect(
      deliveryClocks([
        {
          applications: [
            { position: 'Agent开发工程师', applyTime: '2026-10-14 09:20' },
            { position: 'Agent开发工程师', applyTime: '2026-10-15 10:00' },
          ],
        },
      ]).has('Agent开发工程师'),
    ).toBe(false);
  });
  it('reads Mihoyo progress using the actual application row id and separates batch from employment type', () => {
    expect(
      parseMihoyoRows([
        {
          id: 'delivery-test',
          cells: [
            '平台研发-Agent开发工程师\n校园招聘',
            '上海',
            '研发',
            '全职',
            '2026-10-13',
            'HR初筛',
          ],
        },
      ]),
    ).toEqual([
      {
        id: 'delivery-test',
        position: '平台研发-Agent开发工程师',
        batch: '校园招聘',
        rawStatus: 'HR初筛',
        recruitmentType: '全职',
        appliedAt: '2026-10-13',
      },
    ]);
    expect(
      parseMihoyoRows([{ id: null, cells: ['岗位', '上海', '研发', '全职', '日期', '初筛'] }]),
    ).toEqual([]);
  });
  const row = {
    id: 'delivery-1',
    application_id: 'app-1',
    job_post_info: { title: '前端工程师', job_subject: { name: { i18n: '2027 秋招' } } },
    current_stage: { stage_id: 'stage-1' },
  };
  it('joins Feishu delivery records with the actual stage-list payload shape, regardless of response order', () => {
    expect(
      parseFeishuPayloads([
        { code: 0, data: { delivery_list: [row] } },
        { code: 0, data: { stage_list: [{ id: 'stage-1', name: '业务复试' }] } },
      ]),
    ).toEqual([{ id: 'app-1', position: '前端工程师', batch: '2027 秋招', rawStatus: '业务复试' }]);
    expect(
      parseFeishuPayloads([
        {
          code: 0,
          data: {
            delivery_list: [{ ...row, create_time: Date.parse('2026-09-21T16:30:00.000Z') }],
            stage_list: [{ id: 'stage-1', name: '业务复试' }],
          },
        },
      ])[0].appliedAt,
    ).toBe('2026-09-22 00:30');
    expect(
      parseFeishuPayloads([
        {
          code: 0,
          data: {
            delivery_list: [
              {
                ...row,
                biz_create_time: Date.parse('2026-10-15T02:15:00.000Z'),
                job_post_info: {
                  ...row.job_post_info,
                  publish_time: Date.parse('2026-08-01T00:00:00.000Z'),
                },
              },
            ],
            stage_list: [{ id: 'stage-1', name: '业务复试' }],
          },
        },
      ])[0].appliedAt,
    ).toBe('2026-10-15 10:15');
  });
  it('does not invent textual statuses from numeric codes or job postings', () => {
    expect(parseFeishuPayloads([{ code: 0, data: { delivery_list: [row] } }])[0].rawStatus).toBe(
      '',
    );
    expect(parseMokaPayloads([{ jobs: [{ id: 'job-1', title: '前端', status: 2 }] }])).toEqual([]);
  });
  it('reads the real displayed operation step when the site only exposes current_stage=0', () => {
    const payload = {
      code: 0,
      data: {
        delivery_list: [
          { ...row, current_stage: { stage_id: 0 }, operation_list: [{ operation_code: 1 }] },
        ],
      },
    };
    expect(
      parseFeishuPayloads(
        [payload],
        [
          {
            id: 'dom:前端工程师',
            position: '前端工程师',
            batch: '2027 秋招',
            rawStatus: '投递简历',
          },
        ],
      )[0],
    ).toEqual({
      id: 'app-1',
      position: '前端工程师',
      batch: '2027 秋招',
      rawStatus: '投递简历',
    });
    expect(
      parseFeishuPayloads(
        [payload],
        [
          { id: 'dom:1', position: '前端工程师', batch: '', rawStatus: '投递简历' },
          { id: 'dom:2', position: '前端工程师', batch: '', rawStatus: '一面' },
        ],
      )[0].rawStatus,
    ).toBe('');
  });
  it('rejects conflicting application ids and failed responses', () => {
    const first = { ...row, current_stage: { name: '初筛' } };
    const second = { ...row, current_stage: { name: '一面' } };
    expect(parseFeishuPayloads([{ code: 0, data: { delivery_list: [first, second] } }])).toEqual(
      [],
    );
    expect(parseFeishuPayloads([{ code: 401, data: { delivery_list: [first] } }])).toEqual([]);
  });
  it('only accepts explicit Moka application identifiers and readable statuses', () => {
    expect(
      parseMokaPayloads([
        {
          data: {
            applications: [
              {
                applicationId: 'apply-1',
                jobName: '后端',
                statusName: '初筛',
                projectName: '秋招',
              },
            ],
          },
        },
      ]),
    ).toEqual([{ id: 'apply-1', position: '后端', rawStatus: '初筛', batch: '秋招' }]);
  });
  it('parses the DJI deliver-query fields and uses an unambiguous title/date identity without inventing a batch', () => {
    const application = {
      jobTitle: 'Agent 工程师',
      deliverTime: '2026-10-01 12:30',
      stage: '评估中',
      commitment: '全职',
    };
    const parsed = parseMokaPayloads([{ code: 0, data: { applications: [application] } }]);
    expect(parsed[0]).toMatchObject({
      position: 'Agent 工程师',
      batch: '',
      rawStatus: '评估中',
      recruitmentType: '全职',
      appliedAt: '2026-10-01 12:30',
    });
    expect(parsed[0].id).toContain('2026-10-01 12:30');
    expect(
      parseMokaPayloads([
        { data: { applications: [application, { ...application, stage: '面试中' }] } },
      ]),
    ).toEqual([]);
  });
  it('parses the verified Beisen application objects and never translates numeric stages', () => {
    const row = {
      Id: 'row-1',
      ApplyId: 'apply-1',
      JobAdTitle: 'AI 应用工程师',
      CategoryName: '校园招聘',
      DeliveryStatus: '简历初筛-进行中',
    };
    expect(
      parseSitePayloads([{ Code: 200, Data: { Submissions: [{ Datas: [row] }] } }], 'we.zyt.com'),
    ).toEqual([
      { id: 'apply-1', position: 'AI 应用工程师', batch: '校园招聘', rawStatus: '简历初筛-进行中' },
    ]);
    expect(
      parseSitePayloads([{ Data: [{ ...row, DeliveryStatus: 2 }] }], 'iflytek.zhiye.com')[0]
        .rawStatus,
    ).toBe('');
    expect(
      parseSitePayloads([{ Data: [{ ...row, DeliveryStatus: '2' }] }], 'iflytek.zhiye.com')[0]
        .rawStatus,
    ).toBe('');
    expect(
      parseSitePayloads([{ Data: [row] }], 'hr-campus.vivo.com'),
    ).toEqual([
      { id: 'apply-1', position: 'AI 应用工程师', batch: '校园招聘', rawStatus: '简历初筛-进行中' },
    ]);
  });
  it('joins Huawei progress responses using the exact application reference and keeps future nodes out of the current stage', () => {
    const application = {
      applicationProfileId: 11,
      positionExternalName: '研发',
      externalJobName: 'AI技术应用',
      recruitSceneName: '应届生',
      applicationStatus: '1',
    };
    const progress = {
      status: 'SUCCESS',
      __awaitofferApplicationId: '11',
      data: [
        { processName: '简历筛选', processStatusName: '已完成' },
        { processName: '考试&测评', processStatusName: '进行中' },
        { processName: '面试', processStatusName: '未开始' },
      ],
    };
    expect(
      parseSitePayloads(
        [{ status: 'SUCCESS', data: [application] }, progress],
        'career.huawei.com',
      )[0],
    ).toEqual({
      id: '11',
      position: 'AI技术应用',
      batch: '应届生',
      rawStatus: '考试&测评 - 进行中',
    });
    expect(
      parseSitePayloads(
        [{ data: [{ ...application, applicationTime: '2026-10-01 08:30' }] }, progress],
        'career.huawei.com',
      )[0].appliedAt,
    ).toBe('2026-10-01 08:30');
    expect(
      parseSitePayloads(
        [{ data: [application] }, { ...progress, __awaitofferApplicationId: '12' }],
        'career.huawei.com',
      )[0].rawStatus,
    ).toBe('');
  });
});
describe('bookmark import', () => {
  it('preserves personal-center routes and navigation parameters while stripping authentication tokens', () => {
    expect(
      sanitizeRecruitmentUrl(
        'https://campus.example.com/?recType=campus&access_token=SECRET#/myDeliver?type=present&session=SECRET',
      ),
    ).toBe('https://campus.example.com/?recType=campus#/myDeliver?type=present');
    expect(sanitizeRecruitmentUrl('https://campus.example.com/#access_token=SECRET')).toBe(
      'https://campus.example.com/',
    );
    expect(
      sanitizeRecruitmentUrl(
        'https://app.example.com/apply?candidateName=A&candidateId=1&recommendCode=ok&utm_source=mail',
      ),
    ).toBe('https://app.example.com/apply');
    expect(
      sanitizeRecruitmentUrl(
        'https://app.mokahr.com/campus-recruitment/tuhu/41112#/job/abc/campus_apply/thanks',
      ),
    ).toBe('https://app.mokahr.com/campus-recruitment/tuhu/41112#/candidateHome/applications');
  });
  it('only reads the requested folder, removes private parameters, rejects unsafe URLs and deduplicates', () => {
    const parsed = parseBookmarks({
      roots: {
        bar: {
          type: 'folder',
          children: [
            { type: 'url', name: '不相关', url: 'https://other.example' },
            {
              type: 'folder',
              name: '秋招岗位',
              children: [
                {
                  type: 'url',
                  name: '拓竹',
                  url: 'https://bambulab.jobs.feishu.cn/campus/position/application?token=SECRET#access_token=SECRET',
                },
                {
                  type: 'folder',
                  children: [
                    {
                      type: 'url',
                      name: '重复',
                      url: 'https://bambulab.jobs.feishu.cn/campus/position/application',
                    },
                  ],
                },
                { type: 'url', name: 'unsafe', url: 'javascript:alert(1)' },
              ],
            },
          ],
        },
      },
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0].company).toBe('拓竹科技');
    expect(parsed[0].url).not.toContain('SECRET');
    expect(parsed[0].platform).toBe('feishu');
  });
});
