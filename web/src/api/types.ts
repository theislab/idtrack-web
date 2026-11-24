// Names for the api's schemas (generated in ./schema.ts from api/openapi.json). Nothing here adds a field: the
// frontend reads the api's answers as the document describes them.
import type { components, operations } from "./schema";

type Schemas = components["schemas"];

export type ConversionResult = Schemas["ConversionResult"];
export type Candidate = Schemas["Candidate"];
export type OtherReading = Schemas["OtherReading"];
export type ExplainedPath = Schemas["ExplainedPath"];
export type PathNode = Schemas["PathNode"];
export type GenePlace = Schemas["GenePlace"];
export type PathStep = Schemas["PathStep"];
export type BridgeCheck = Schemas["BridgeCheck"];
export type BatchRequest = Schemas["BatchRequest"];
export type BatchResponse = Schemas["BatchResponse"];
export type GraphDescription = Schemas["GraphDescription"];
export type AssemblyDescription = Schemas["AssemblyDescription"];
export type OrganismsResponse = Schemas["OrganismsResponse"];
export type FinalDatabasesResponse = Schemas["FinalDatabasesResponse"];
export type NamesResponse = Schemas["NamesResponse"];
export type NameMatch = Schemas["NameMatch"];
export type VersionResponse = Schemas["VersionResponse"];
export type GraphVersion = Schemas["GraphVersion"];
export type HealthResponse = Schemas["HealthResponse"];
export type ErrorBody = Schemas["ErrorBody"];
export type VocabularyResponse = Schemas["VocabularyResponse"];
export type Term = Schemas["Term"];
export type CriterionTerm = Schemas["CriterionTerm"];
export type CriterionField = Schemas["CriterionField"];
export type BridgeRuleTerm = Schemas["BridgeRuleTerm"];
export type ErrorTerm = Schemas["ErrorTerm"];
export type LimitsResponse = Schemas["LimitsResponse"];
export type ErrorResponse = Schemas["ErrorResponse"];

/** The query of one conversion, as the convert endpoint takes it. */
export type ConvertQuery = NonNullable<
  operations["convert_api_v1_organisms__organism__convert_get"]["parameters"]["query"]
>;
