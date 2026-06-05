import { describe, expect, it } from "vitest";
import {
  buildGetDatabaseListSoapEnvelope,
  buildJavaWsEndpointUrl,
  buildQueryCompressSoapEnvelope,
  compressSqlForJavaWs,
  decompressJavaWsPayload,
  extractSoapBase64Return,
  extractSoapReturnText,
  parseJavaWsRows,
} from "./sml-javaws-client.js";

describe("SML JavaWS client helpers", () => {
  it("builds the DotNetFrameWork _queryCompress SOAP request", () => {
    const zipped = compressSqlForJavaWs("select 1 as ok").toString("base64");
    const envelope = buildQueryCompressSoapEnvelope({
      guid: "AI_BCC",
      configFileName: "SMLConfigDATA.xml",
      databaseName: "sml1_2026",
      zippedQueryBase64: zipped,
    });

    expect(envelope).toContain("<_queryCompress xmlns=\"http://SMLWebService/\">");
    expect(envelope).toContain("<arg1 xmlns=\"\">SMLConfigDATA.xml</arg1>");
    expect(envelope).toContain("<arg2 xmlns=\"\">sml1_2026</arg2>");
    expect(decompressJavaWsPayload(Buffer.from(zipped, "base64"))).toBe(
      "select 1 as ok",
    );
  });

  it("extracts compressed SOAP responses and parses ResultSet rows", () => {
    const resultXml =
      "<?xml version=\"1.0\" encoding=\"utf-8\"?><ResultSet><Row><doc_no>IV-001</doc_no><total_amount>123.45000000000000</total_amount><has_ic_trans>true</has_ic_trans></Row></ResultSet>";
    const zippedResult = compressSqlForJavaWs(resultXml).toString("base64");
    const soap = `<?xml version="1.0" ?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ns2:_queryCompressResponse xmlns:ns2="http://SMLWebService/"><return>${zippedResult}</return></ns2:_queryCompressResponse></soap:Body></soap:Envelope>`;

    const returnedBase64 = extractSoapBase64Return(soap);
    const rows = parseJavaWsRows(
      decompressJavaWsPayload(Buffer.from(returnedBase64, "base64")),
    );

    expect(rows).toEqual([
      {
        doc_no: "IV-001",
        has_ic_trans: "true",
        total_amount: "123.45000000000000",
      },
    ]);
  });

  it("normalizes the JavaWS endpoint URL", () => {
    expect(
      buildJavaWsEndpointUrl({
        baseUrl: "http://localhost:8080/",
        webappPath: "/SMLJavaWebService/",
        endpoint: "DotNetFrameWork",
      }),
    ).toBe("http://localhost:8080/SMLJavaWebService/DotNetFrameWork");
  });

  it("treats an empty ResultSet as no rows", () => {
    expect(
      parseJavaWsRows(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?><ResultSet></ResultSet>",
      ),
    ).toEqual([]);
    expect(
      parseJavaWsRows(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?><ResultSet/>",
      ),
    ).toEqual([]);
  });

  it("builds database discovery requests and parses plain XML returns", () => {
    const envelope = buildGetDatabaseListSoapEnvelope({
      guid: "AI_BCC",
      configFileName: "SMLConfigDEMO.xml",
    });
    expect(envelope).toContain("<_getDatabaseList xmlns=\"http://SMLWebService/\">");
    expect(envelope).toContain("<arg1 xmlns=\"\">SMLConfigDEMO.xml</arg1>");

    const soap =
      "<?xml version='1.0' encoding='UTF-8'?><S:Envelope xmlns:S=\"http://schemas.xmlsoap.org/soap/envelope/\"><S:Body><ns2:_getDatabaseListResponse xmlns:ns2=\"http://SMLWebService/\"><return>&lt;?xml version=\"1.0\" encoding=\"utf-8\"?&gt;&lt;ResultSet&gt;&lt;Row&gt;&lt;data_code&gt;DEMO&lt;/data_code&gt;&lt;data_name&gt;DEMO&lt;/data_name&gt;&lt;data_database_name&gt;DEMO&lt;/data_database_name&gt;&lt;/Row&gt;&lt;/ResultSet&gt;</return></ns2:_getDatabaseListResponse></S:Body></S:Envelope>";
    expect(parseJavaWsRows(extractSoapReturnText(soap))).toEqual([
      {
        data_code: "DEMO",
        data_database_name: "DEMO",
        data_name: "DEMO",
      },
    ]);
  });
});
